import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const intentSource = fs.readFileSync("apps/mobile/src/db/checkout-intents.ts", "utf8");
const schemaSource = fs.readFileSync("apps/mobile/src/db/schema.ts", "utf8");
const posSource = fs.readFileSync("apps/mobile/app/(app)/pos.tsx", "utf8");
const tenderSource = fs.readFileSync("apps/mobile/src/features/cashier/cashier-tender-panel.tsx", "utf8");
const cacheAdminSource = fs.readFileSync("apps/mobile/src/db/cache-admin.ts", "utf8");
const custodySource = fs.readFileSync("apps/mobile/src/features/offline/transaction-custody.ts", "utf8");

const extractTemplate = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const templateStart = source.indexOf("`", start);
  const templateEnd = source.indexOf("`", templateStart + 1);
  assert.notEqual(templateStart, -1);
  assert.notEqual(templateEnd, -1);
  return source.slice(templateStart + 1, templateEnd);
};

const migrationSql = extractTemplate(schemaSource, 'name: "mob_01_durable_online_checkout_intents"');
const insertSql = extractTemplate(intentSource, "INSERT_CHECKOUT_INTENT_SQL");
const recoverSql = extractTemplate(intentSource, "RECOVER_INTERRUPTED_CHECKOUT_INTENTS_SQL");
const loadSql = extractTemplate(intentSource, "LOAD_UNRESOLVED_CHECKOUT_INTENT_SQL");
const submittingSql = extractTemplate(intentSource, "MARK_CHECKOUT_INTENT_SUBMITTING_SQL");
const acknowledgedSql = extractTemplate(intentSource, "MARK_CHECKOUT_INTENT_ACKNOWLEDGED_SQL");

const payload = (idempotencyKey, quantity = 1) => ({
  storeId: "store-a",
  registerId: "register-a",
  idempotencyKey,
  customerId: null,
  loyaltyRedemptionPoints: 0,
  discountId: null,
  taxRateId: null,
  diningOptionId: null,
  openTicketId: null,
  items: [{
    productId: "product-a",
    variantId: null,
    quantity,
    unitPriceMinor: null,
    modifierOptionIds: [],
    itemNote: null,
  }],
  payments: [{
    paymentMethodId: "cash-a",
    tenderedAmount: "20.00",
    referenceNumber: "",
    note: "",
  }],
});

const createDatabase = () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE outbox_events (event_id TEXT PRIMARY KEY, organization_id TEXT, state TEXT);
    CREATE TABLE device_sync_state (organization_id TEXT, device_id TEXT, next_sequence INTEGER, server_checkpoint INTEGER);
    CREATE TABLE sync_cursors (organization_id TEXT, device_id TEXT, store_id TEXT, pull_cursor INTEGER);
    INSERT INTO outbox_events VALUES ('event-1','org-a','LOCAL_PENDING');
    INSERT INTO device_sync_state VALUES ('org-a','device-a',8,6);
    INSERT INTO sync_cursors VALUES ('org-a','device-a','store-a',5);
  `);
  database.exec(migrationSql);
  return database;
};

const insertIntent = (database, checkoutPayload, createdAt = "2026-10-07T00:00:00.000Z") => database
  .prepare(insertSql)
  .run(
    checkoutPayload.idempotencyKey,
    "org-a",
    checkoutPayload.storeId,
    checkoutPayload.registerId,
    "device-a",
    "employee-a",
    "shift-a",
    checkoutPayload.idempotencyKey,
    JSON.stringify(checkoutPayload),
    createdAt,
    createdAt,
  );

test("MOB-01 persists an immutable checkout identity and payload before delivery", () => {
  const database = createDatabase();
  const key = "11111111-1111-4111-8111-111111111111";
  const original = payload(key);
  insertIntent(database, original);
  insertIntent(database, payload(key, 2), "2026-10-07T00:01:00.000Z");

  const row = database.prepare("SELECT * FROM checkout_intents WHERE intent_id=?").get(key);
  assert.equal(row.idempotency_key, key);
  assert.equal(row.state, "PREPARED");
  assert.equal(row.attempts, 0);
  assert.deepEqual(JSON.parse(row.payload_json), original);
  assert.match(intentSource, /row\.payload_json !== payloadJson/);
  assert.match(intentSource, /ONLINE_CHECKOUT_IDENTITY_CONFLICT/);
});

test("MOB-01 process-death recovery retries the exact payload and reaches one terminal acknowledgement", () => {
  const database = createDatabase();
  const key = "22222222-2222-4222-8222-222222222222";
  const original = payload(key);
  insertIntent(database, original);

  database.prepare(submittingSql).run(
    "2026-10-07T00:01:00.000Z",
    "2026-10-07T00:01:00.000Z",
    "org-a",
    key,
  );
  assert.equal(database.prepare("SELECT state FROM checkout_intents WHERE intent_id=?").get(key).state, "SUBMITTING");

  database.prepare(recoverSql).run(
    "2026-10-07T00:02:00.000Z",
    "org-a",
    "device-a",
  );
  const recovered = database.prepare(loadSql).get("org-a", "device-a");
  assert.equal(recovered.state, "UNKNOWN");
  assert.equal(recovered.idempotency_key, key);
  assert.deepEqual(JSON.parse(recovered.payload_json), original);

  database.prepare(submittingSql).run(
    "2026-10-07T00:03:00.000Z",
    "2026-10-07T00:03:00.000Z",
    "org-a",
    key,
  );
  database.prepare(acknowledgedSql).run(
    "sale-a",
    4321,
    "2026-10-07T00:04:00.000Z",
    "org-a",
    key,
  );

  const acknowledged = database.prepare("SELECT * FROM checkout_intents WHERE intent_id=?").get(key);
  assert.equal(acknowledged.state, "ACKNOWLEDGED");
  assert.equal(acknowledged.attempts, 2);
  assert.equal(acknowledged.server_sale_id, "sale-a");
  assert.equal(acknowledged.official_receipt_number, 4321);
  assert.equal(database.prepare(loadSql).get("org-a", "device-a"), undefined);
});

test("MOB-01 migration and cache cleanup preserve transaction custody", () => {
  const database = createDatabase();
  assert.equal(database.prepare("SELECT state FROM outbox_events").get().state, "LOCAL_PENDING");
  assert.equal(database.prepare("SELECT next_sequence FROM device_sync_state").get().next_sequence, 8);
  assert.equal(database.prepare("SELECT server_checkpoint FROM device_sync_state").get().server_checkpoint, 6);
  assert.equal(database.prepare("SELECT pull_cursor FROM sync_cursors").get().pull_cursor, 5);
  for (const text of ["checkout_intents", "outbox_events", "local_receipts", "device_sync_state", "sync_cursors", "intentionally excluded"]) assert.ok(cacheAdminSource.includes(text));
  assert.doesNotMatch(cacheAdminSource, /DELETE FROM checkout_intents/);
  assert.match(custodySource, /FROM checkout_intents WHERE organization_id=\? AND state IN \('PREPARED','SUBMITTING','UNKNOWN'\)/);
  assert.match(custodySource, /onlineCheckoutIntents/);
});

test("MOB-01 POS persists before send, recovers on startup, and blocks new offline fallback", () => {
  assert.ok(posSource.indexOf("prepareOnlineCheckoutIntent(") < posSource.indexOf("checkoutPosV2("));
  assert.match(posSource, /recoverInterruptedOnlineCheckoutIntents\(/);
  assert.match(posSource, /getUnresolvedOnlineCheckoutIntent\(/);
  assert.match(posSource, /checkoutPosV2\([\s\S]*?intent\.payload/);
  assert.match(posSource, /Boolean\(onlineIntent\)[\s\S]*?!offlineCartEligible/);
  assert.match(posSource, /onlineIntent\.employeeId === core\.employee\.id/);
  assert.match(posSource, /onlineIntent\.shiftId === core\.activeShift\.id/);
  assert.match(posSource, /onlineIntent\.storeId === binding\.storeId/);
  assert.match(posSource, /onlineIntent\.registerId === binding\.registerId/);
  assert.match(posSource, /!onlineIntentMatchesCurrentContext/);
  assert.match(tenderSource, /Retry original checkout/);
  assert.match(tenderSource, /Offline fallback stays blocked until its result is resolved/);
});

test("MOB-01 corrupt durable payloads fail closed instead of disappearing", () => {
  assert.match(intentSource, /payload\.idempotencyKey !== row\.idempotency_key/);
  assert.match(intentSource, /payload\.storeId !== row\.store_id/);
  assert.match(intentSource, /payload\.registerId !== row\.register_id/);
  assert.match(intentSource, /throw new Error\("ONLINE_CHECKOUT_INTENT_CORRUPT"\)/);
});
