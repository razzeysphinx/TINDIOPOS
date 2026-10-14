import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");
const baseline = read("database/baseline/0001_tindio_baseline.sql");
const checkoutSource = read("src/features/checkout/checkout-service.ts");
const schemaSource = read("apps/mobile/src/db/schema.ts");
const outboxSource = read("apps/mobile/src/db/outbox.ts");

function templateAfter(source, marker) {
  const markerAt = source.indexOf(marker);
  assert.notEqual(markerAt, -1, `Missing ${marker}`);
  const start = source.indexOf("`", markerAt);
  const end = source.indexOf("`", start + 1);
  assert.ok(start > markerAt && end > start, `Missing SQL template for ${marker}`);
  return source.slice(start + 1, end);
}

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const policy = await loadTypeScriptModule("apps/mobile/src/features/outbox/recovery-policy.ts");
const migrationSql = templateAfter(schemaSource, 'name: "mob_04_outbox_recovery_audit"');
const updateSql = templateAfter(outboxSource, "OUTBOX_RECOVERY_UPDATE_SQL");
const auditSql = templateAfter(outboxSource, "OUTBOX_RECOVERY_AUDIT_SQL");

test("A32 sends the immutable offline total and maps a server mismatch to PRICE_CHANGED", () => {
  assert.match(checkoutSource, /\[tindio-offline-total:\$\{data\.offlineExpectedTotalMinor\}\]/);
  assert.match(checkoutSource, /normalized\.includes\("queued sale total changed"\)[\s\S]*return "PRICE_CHANGED"/);
  assert.match(baseline, /guard_offline_checkout_total[\s\S]*This queued sale total changed while offline/);
  assert.match(baseline, /guard_offline_payment_total_marker[\s\S]*This queued sale total changed while offline/);
});

test("A32 price conflict requires current manager authority", () => {
  const event = {
    eventId: "event-a32", organizationId: "org-a", storeId: "store-a",
    registerId: "register-a", deviceId: "device-a", deviceSequence: 1109,
    employeeId: "employee-a", localReference: "OFF-A32PRICE1", state: "CONFLICT",
    createdAt: "2026-10-13T13:20:00.000Z", lastError: "The queued sale total changed while offline.",
    conflictType: "PRICE_CHANGED", currencyCode: "PHP", totalMinor: 100, itemCount: 1, corrupt: false,
  };
  const actor = {
    organizationId: "org-a", profileId: "profile-a", employeeId: "employee-a",
    permissions: ["pos.access", "sales.create", "payments.accept"], storeIds: ["store-a"],
    deviceId: "device-a", storeId: "store-a", registerId: "register-a",
  };
  assert.deepEqual(policy.evaluateOutboxRecovery(event, actor), {
    ok: false,
    reason: "FINANCIAL_MANAGER_REVIEW_REQUIRED",
  });
  assert.deepEqual(
    policy.evaluateOutboxRecovery(event, { ...actor, permissions: [...actor.permissions, "sales.refund"] }),
    { ok: true, requiresManagerReview: true },
  );
});

test("A32 audited retry preserves the original obligation, identities, receipt, and sequence", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(`
    CREATE TABLE outbox_events (
      event_id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, store_id TEXT NOT NULL,
      register_id TEXT NOT NULL, device_id TEXT NOT NULL, device_sequence INTEGER NOT NULL,
      idempotency_key TEXT NOT NULL, local_reference TEXT NOT NULL, payload_json TEXT NOT NULL,
      snapshot_json TEXT NOT NULL, state TEXT NOT NULL, next_retry_at TEXT, last_error TEXT,
      conflict_type TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE local_receipts (
      event_id TEXT PRIMARY KEY NOT NULL, local_reference TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES outbox_events(event_id) ON DELETE RESTRICT
    );
    CREATE TABLE device_sync_state (
      organization_id TEXT, device_id TEXT, next_sequence INTEGER, server_checkpoint INTEGER
    );
  `);
  database.exec(migrationSql);
  const payload = JSON.stringify({ checkout: { idempotencyKey: "checkout-key-a32", offlineExpectedTotalMinor: 100 } });
  const snapshot = JSON.stringify({ localReceiptReference: "OFF-A32PRICE1", totalMinor: 100, tenderedMinor: 100 });
  database.prepare(`INSERT INTO outbox_events
    (event_id,organization_id,store_id,register_id,device_id,device_sequence,idempotency_key,local_reference,payload_json,snapshot_json,state,next_retry_at,last_error,conflict_type,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "event-a32", "org-a", "store-a", "register-a", "device-a", 1109,
    "checkout-key-a32", "OFF-A32PRICE1", payload, snapshot, "CONFLICT", null,
    "This queued sale total changed while offline.", "PRICE_CHANGED", "2026-10-13T13:25:00.000Z",
  );
  database.prepare("INSERT INTO local_receipts VALUES (?,?,?)").run("event-a32", "OFF-A32PRICE1", snapshot);
  database.exec("INSERT INTO device_sync_state VALUES ('org-a','device-a',1110,1108)");

  const before = database.prepare("SELECT * FROM outbox_events WHERE event_id='event-a32'").get();
  const receiptBefore = database.prepare("SELECT * FROM local_receipts WHERE event_id='event-a32'").get();
  database.exec("BEGIN IMMEDIATE");
  try {
    const updated = database.prepare(updateSql).run(
      "Retry authorized by employee manager-a.", "2026-10-13T13:41:01.811Z",
      "org-a", "device-a", "event-a32", "CONFLICT",
    );
    assert.equal(updated.changes, 1);
    database.prepare(auditSql).run(
      "org-a", "event-a32", "device-a", "profile-manager", "manager-a", "CONFLICT",
      before.last_error, before.conflict_type, "RETRY_AUTHORIZED",
      "A32 price restored after audited review", "2026-10-13T13:41:01.811Z",
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  const after = database.prepare("SELECT * FROM outbox_events WHERE event_id='event-a32'").get();
  const receiptAfter = database.prepare("SELECT * FROM local_receipts WHERE event_id='event-a32'").get();
  assert.equal(after.state, "LOCAL_PENDING");
  for (const column of [
    "event_id", "organization_id", "store_id", "register_id", "device_id", "device_sequence",
    "idempotency_key", "local_reference", "payload_json", "snapshot_json",
  ]) assert.equal(after[column], before[column], `${column} changed during A32 recovery`);
  assert.deepEqual(receiptAfter, receiptBefore);
  assert.deepEqual({ ...database.prepare("SELECT prior_state,prior_conflict_type,action,reason FROM outbox_recovery_actions").get() }, {
    prior_state: "CONFLICT",
    prior_conflict_type: "PRICE_CHANGED",
    action: "RETRY_AUTHORIZED",
    reason: "A32 price restored after audited review",
  });
  assert.deepEqual({ ...database.prepare("SELECT next_sequence,server_checkpoint FROM device_sync_state").get() }, {
    next_sequence: 1110,
    server_checkpoint: 1108,
  });
  assert.equal(database.prepare("SELECT COUNT(*) count FROM outbox_events").get().count, 1);
  database.close();
});
