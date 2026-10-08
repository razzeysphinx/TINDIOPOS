import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";

const read = (path) => fs.readFileSync(path, "utf8");
const custodySource = read("apps/mobile/src/db/shift-custody.ts");
const preparationSource = read("apps/mobile/src/features/shifts/prepare-shift-finalization.ts");
const shiftScreenSource = read("apps/mobile/app/(app)/shift.tsx");

function templateAfter(source, marker) {
  const markerAt = source.indexOf(marker);
  assert.notEqual(markerAt, -1, `Missing ${marker}`);
  const start = source.indexOf("`", markerAt);
  const end = source.indexOf("`", start + 1);
  return source.slice(start + 1, end);
}

async function loadTypeScriptModule(file) {
  const output = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}

const policy = await loadTypeScriptModule("apps/mobile/src/features/shifts/shift-finalization-policy.ts");
const custodySql = templateAfter(custodySource, "SHIFT_FINALIZATION_CUSTODY_SQL");
const scope = ["org-a", "device-a", "store-a", "register-a"];
const custodyParams = (shiftId = "shift-a") => [
  ...scope, ...scope, shiftId, ...scope, ...scope, ...scope, shiftId,
  "org-a", "device-a", "org-a", "device-a",
];

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE outbox_events (
      event_id TEXT PRIMARY KEY,organization_id TEXT,device_id TEXT,store_id TEXT,
      register_id TEXT,shift_id TEXT,state TEXT,idempotency_key TEXT,payload_json TEXT
    );
    CREATE TABLE checkout_intents (
      intent_id TEXT PRIMARY KEY,organization_id TEXT,device_id TEXT,store_id TEXT,
      register_id TEXT,shift_id TEXT,state TEXT,idempotency_key TEXT,payload_json TEXT
    );
    CREATE TABLE device_sync_state (
      organization_id TEXT,device_id TEXT,next_sequence INTEGER,server_checkpoint INTEGER,
      PRIMARY KEY(organization_id,device_id)
    );
    INSERT INTO device_sync_state VALUES ('org-a','device-a',8,6);
  `);
  return database;
}

function inspect(database, shiftId = "shift-a") {
  const row = database.prepare(custodySql).get(...custodyParams(shiftId));
  return {
    unresolvedOutboxCount: row.unresolved_outbox_count,
    shiftOutboxCount: row.shift_outbox_count,
    reviewOutboxCount: row.review_outbox_count,
    unresolvedCheckoutCount: row.unresolved_checkout_count,
    shiftCheckoutCount: row.shift_checkout_count,
    localHighWater: row.local_high_water,
    serverCheckpoint: row.server_checkpoint,
  };
}

test("MOB-08 shift custody sees every unresolved money state in the current terminal scope", () => {
  const database = createDatabase();
  const outbox = database.prepare("INSERT INTO outbox_events VALUES (?,?,?,?,?,?,?,?,?)");
  for (const [index, state] of ["LOCAL_PENDING", "SYNCING", "FAILED", "CONFLICT", "SYNCED"].entries()) {
    outbox.run(`event-${index}`, "org-a", "device-a", "store-a", "register-a", "shift-a", state,
      `key-${index}`, `{\"state\":\"${state}\"}`);
  }
  outbox.run("foreign-store", "org-a", "device-a", "store-b", "register-b", "shift-a", "FAILED", "foreign-key", "{}");
  const intent = database.prepare("INSERT INTO checkout_intents VALUES (?,?,?,?,?,?,?,?,?)");
  for (const [index, state] of ["PREPARED", "SUBMITTING", "UNKNOWN", "ACKNOWLEDGED", "REJECTED"].entries()) {
    intent.run(`intent-${index}`, "org-a", "device-a", "store-a", "register-a", "shift-a", state,
      `intent-key-${index}`, `{\"state\":\"${state}\"}`);
  }
  intent.run("foreign-tenant", "org-b", "device-a", "store-a", "register-a", "shift-a", "UNKNOWN", "foreign-intent", "{}");

  const custody = inspect(database);
  assert.equal(custody.unresolvedOutboxCount, 4);
  assert.equal(custody.shiftOutboxCount, 4);
  assert.equal(custody.reviewOutboxCount, 2);
  assert.equal(custody.unresolvedCheckoutCount, 3);
  assert.equal(custody.shiftCheckoutCount, 3);
});

test("MOB-08 policy fails closed and gives financial review precedence", () => {
  const base = {
    unresolvedOutboxCount: 0, shiftOutboxCount: 0, reviewOutboxCount: 0,
    unresolvedCheckoutCount: 0, shiftCheckoutCount: 0, localHighWater: 7, serverCheckpoint: 7,
  };
  assert.deepEqual(policy.evaluateShiftFinalization(base, false), { ok: false, reason: "CHECKPOINT_UNAVAILABLE" });
  assert.deepEqual(policy.evaluateShiftFinalization({ ...base, unresolvedCheckoutCount: 1 }, true), { ok: false, reason: "ONLINE_CHECKOUT_UNRESOLVED" });
  assert.deepEqual(policy.evaluateShiftFinalization({ ...base, unresolvedOutboxCount: 1, reviewOutboxCount: 1 }, true), { ok: false, reason: "OUTBOX_REVIEW_REQUIRED" });
  assert.deepEqual(policy.evaluateShiftFinalization({ ...base, unresolvedOutboxCount: 1 }, true), { ok: false, reason: "OUTBOX_SYNC_REQUIRED" });
  assert.deepEqual(policy.evaluateShiftFinalization({ ...base, serverCheckpoint: 6 }, true), { ok: false, reason: "CHECKPOINT_NOT_RECONCILED" });
  assert.deepEqual(policy.evaluateShiftFinalization(base, true), { ok: true });
});

test("MOB-08 reconciliation preserves transaction identity and opens only after full ACK", () => {
  const database = createDatabase();
  database.exec(`INSERT INTO outbox_events VALUES
    ('event-a','org-a','device-a','store-a','register-a','shift-a','LOCAL_PENDING','stable-key','{"amount":500}')`);
  const before = database.prepare("SELECT * FROM outbox_events WHERE event_id='event-a'").get();
  assert.equal(policy.evaluateShiftFinalization(inspect(database), true).ok, false);
  database.exec("UPDATE outbox_events SET state='SYNCED' WHERE event_id='event-a'; UPDATE device_sync_state SET server_checkpoint=7 WHERE organization_id='org-a' AND device_id='device-a'");
  assert.deepEqual(policy.evaluateShiftFinalization(inspect(database), true), { ok: true });
  const after = database.prepare("SELECT * FROM outbox_events WHERE event_id='event-a'").get();
  for (const field of ["event_id", "organization_id", "device_id", "store_id", "register_id", "shift_id", "idempotency_key", "payload_json"]) {
    assert.equal(after[field], before[field], `${field} changed during reconciliation`);
  }
});

test("MOB-08 native close performs sync and checkpoint verification before the close API", () => {
  for (const marker of ["recoverInterruptedOnlineCheckoutIntents", "syncOutboxEvents", "refreshDeviceCheckpoint", "getShiftFinalizationCustody", "evaluateShiftFinalization"]) {
    assert.ok(preparationSource.includes(marker));
  }
  assert.ok(shiftScreenSource.indexOf("prepareShiftFinalization({") < shiftScreenSource.indexOf("closePosV2Shift("));
  assert.match(shiftScreenSource, /if \(!preparation\.ok\)[\s\S]*return;/);
  assert.match(shiftScreenSource, /do not assume the drawer is closed/);
  assert.doesNotMatch(custodySource + preparationSource, /DELETE FROM|DROP TABLE|randomUUID/i);
});
