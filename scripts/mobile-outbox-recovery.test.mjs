import assert from "node:assert/strict";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

const read = (file) => fs.readFileSync(file, "utf8");
const schemaSource = read("apps/mobile/src/db/schema.ts");
const outboxSource = read("apps/mobile/src/db/outbox.ts");
const recoverySource = read("apps/mobile/src/features/outbox/outbox-recovery.ts");
const sessionSource = read("apps/mobile/src/features/session/session-provider.tsx");
const screenSource = read("apps/mobile/app/(app)/sync-status.tsx");

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

const policy = await loadTypeScriptModule(
  "apps/mobile/src/features/outbox/recovery-policy.ts",
);
const migrationSql = templateAfter(schemaSource, 'name: "mob_04_outbox_recovery_audit"');
const updateSql = templateAfter(outboxSource, "OUTBOX_RECOVERY_UPDATE_SQL");
const auditSql = templateAfter(outboxSource, "OUTBOX_RECOVERY_AUDIT_SQL");

const event = (overrides = {}) => ({
  eventId: "event-1",
  organizationId: "org-a",
  storeId: "store-a",
  registerId: "register-a",
  deviceId: "device-a",
  deviceSequence: 7,
  employeeId: "employee-a",
  localReference: "OFF-0007",
  state: "FAILED",
  createdAt: "2026-10-08T00:00:00.000Z",
  lastError: "Sign in again.",
  conflictType: "AUTHORIZATION_CHANGED",
  currencyCode: "PHP",
  totalMinor: 1250,
  itemCount: 2,
  corrupt: false,
  ...overrides,
});

const actor = (overrides = {}) => ({
  organizationId: "org-a",
  profileId: "profile-a",
  employeeId: "employee-a",
  permissions: ["pos.access", "sales.create", "payments.accept"],
  storeIds: ["store-a"],
  deviceId: "device-a",
  storeId: "store-a",
  registerId: "register-a",
  ...overrides,
});

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(`
    CREATE TABLE outbox_events (
      event_id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL,
      store_id TEXT NOT NULL, register_id TEXT NOT NULL, device_id TEXT NOT NULL,
      device_sequence INTEGER NOT NULL, idempotency_key TEXT NOT NULL,
      payload_json TEXT NOT NULL, state TEXT NOT NULL, next_retry_at TEXT,
      last_error TEXT, conflict_type TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE device_sync_state (organization_id TEXT, device_id TEXT, next_sequence INTEGER, server_checkpoint INTEGER);
    CREATE TABLE sync_cursors (organization_id TEXT, device_id TEXT, store_id TEXT, pull_cursor INTEGER);
  `);
  database.exec(migrationSql);
  database.prepare("INSERT INTO outbox_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(
    "event-1", "org-a", "store-a", "register-a", "device-a", 7,
    "checkout-key-original", '{"checkout":{"idempotencyKey":"checkout-key-original"}}',
    "FAILED", null, "Sign in again.", "AUTHORIZATION_CHANGED", "2026-10-08T00:00:00.000Z",
  );
  database.exec("INSERT INTO device_sync_state VALUES ('org-a','device-a',8,6)");
  database.exec("INSERT INTO sync_cursors VALUES ('org-a','device-a','store-a',41)");
  return database;
}

test("MOB-04 capability, tenant, store, terminal, and manager boundaries fail closed", () => {
  assert.equal(policy.evaluateOutboxRecovery(event(), actor()).ok, true);
  for (const denied of [
    [event(), actor({ organizationId: "org-b" }), "TENANT_MISMATCH"],
    [event(), actor({ storeIds: ["store-b"] }), "STORE_ACCESS_REQUIRED"],
    [event(), actor({ deviceId: "device-b" }), "DEVICE_MISMATCH"],
    [event(), actor({ registerId: "register-b" }), "TERMINAL_BINDING_REVALIDATION_REQUIRED"],
    [event(), actor({ permissions: ["pos.access", "sales.create"] }), "CHECKOUT_PERMISSION_REQUIRED"],
    [event(), actor({ employeeId: "employee-b" }), "FINANCIAL_MANAGER_REVIEW_REQUIRED"],
    [event({ state: "CONFLICT", conflictType: "PRICE_CHANGED" }), actor(), "FINANCIAL_MANAGER_REVIEW_REQUIRED"],
    [event({ state: "CONFLICT", conflictType: "SEQUENCE_GAP" }), actor({ permissions: ["pos.access", "sales.create", "payments.accept", "sales.refund"] }), "SEQUENCE_ESCALATION_REQUIRED"],
    [event({ corrupt: true }), actor(), "CORRUPT_EVENT_REQUIRES_ESCALATION"],
  ]) {
    assert.deepEqual(policy.evaluateOutboxRecovery(denied[0], denied[1]), { ok: false, reason: denied[2] });
  }
  assert.deepEqual(
    policy.evaluateOutboxRecovery(
      event({ state: "CONFLICT", conflictType: "PRICE_CHANGED" }),
      actor({ permissions: ["pos.access", "sales.create", "payments.accept", "sales.refund"] }),
    ),
    { ok: true, requiresManagerReview: true },
  );
});

test("MOB-04 audited retry preserves transaction identity and custody state", () => {
  const database = createDatabase();
  database.exec("BEGIN IMMEDIATE");
  const before = database.prepare("SELECT * FROM outbox_events WHERE event_id='event-1'").get();
  const updated = database.prepare(updateSql).run(
    "Retry authorized by employee employee-a.", "2026-10-08T00:05:00.000Z",
    "org-a", "device-a", "event-1", "FAILED",
  );
  assert.equal(updated.changes, 1);
  database.prepare(auditSql).run(
    "org-a", "event-1", "device-a", "profile-a", "employee-a", "FAILED",
    before.last_error, before.conflict_type, "RETRY_AUTHORIZED", "Credentials refreshed", "2026-10-08T00:05:00.000Z",
  );
  database.exec("COMMIT");

  const after = database.prepare("SELECT * FROM outbox_events WHERE event_id='event-1'").get();
  assert.equal(after.state, "LOCAL_PENDING");
  for (const column of ["event_id", "organization_id", "store_id", "register_id", "device_id", "device_sequence", "idempotency_key", "payload_json"]) {
    assert.equal(after[column], before[column], `${column} changed during retry`);
  }
  const audit = database.prepare("SELECT * FROM outbox_recovery_actions").get();
  assert.equal(audit.prior_state, "FAILED");
  assert.equal(audit.prior_error, "Sign in again.");
  assert.equal(audit.prior_conflict_type, "AUTHORIZATION_CHANGED");
  assert.equal(audit.actor_employee_id, "employee-a");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM outbox_events").get().count, 1);
  assert.equal(database.prepare("SELECT next_sequence FROM device_sync_state").get().next_sequence, 8);
  assert.equal(database.prepare("SELECT server_checkpoint FROM device_sync_state").get().server_checkpoint, 6);
  assert.equal(database.prepare("SELECT pull_cursor FROM sync_cursors").get().pull_cursor, 41);
  database.close();
});

test("MOB-04 audit failure rolls the retry transition back atomically", () => {
  const database = createDatabase();
  assert.throws(() => {
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(updateSql).run("Retrying", "2026-10-08T00:05:00.000Z", "org-a", "device-a", "event-1", "FAILED");
      database.prepare(auditSql).run("org-a", "event-1", "device-a", "profile-a", "employee-a", "FAILED", null, null, "RETRY_AUTHORIZED", null, "2026-10-08T00:05:00.000Z");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });
  assert.equal(database.prepare("SELECT state FROM outbox_events").get().state, "FAILED");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM outbox_recovery_actions").get().count, 0);
  database.close();
});

test("MOB-04 product controls reauthenticate in place and reuse the MOB-03 coordinator", () => {
  assert.match(sessionSource, /reauthenticate/);
  assert.match(sessionSource, /signInWithPassword/);
  assert.match(sessionSource, /fetchPosV2Core\(organizationId\)/);
  assert.match(recoverySource, /authorizeOutboxRecoveryRetry/);
  assert.match(recoverySource, /syncOutboxEvents\(input\.organizationId\)/);
  assert.match(screenSource, /Reauthenticate in place/);
  assert.match(screenSource, /Retry original transaction/);
  assert.match(screenSource, /accessMode !== "online"/);
  assert.doesNotMatch(recoverySource + outboxSource, /randomUUID|DELETE\s+FROM\s+outbox_events/i);
});

test("MOB-04 corrupt rows remain visible and non-retryable without a database reset", () => {
  assert.match(outboxSource, /listOutboxRecoveryItems/);
  assert.match(outboxSource, /corrupt: event === null/);
  assert.match(outboxSource, /state <> 'SYNCED'/);
  assert.match(schemaSource, /TINDIO_LOCAL_SCHEMA_VERSION = 11/);
  assert.match(schemaSource, /ON DELETE RESTRICT/);
  assert.doesNotMatch(schemaSource, /DROP TABLE|DELETE FROM outbox_events/i);
});
