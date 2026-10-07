import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const receiptSource = fs.readFileSync("apps/mobile/src/db/receipt-cache.ts", "utf8");
const screenSource = fs.readFileSync("apps/mobile/app/(app)/receipts.tsx", "utf8");
const contextSource = fs.readFileSync("apps/mobile/src/features/business/business-context-provider.tsx", "utf8");

const extractTemplate = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const templateStart = source.indexOf("`", start);
  const templateEnd = source.indexOf("`", templateStart + 1);
  return source.slice(templateStart + 1, templateEnd);
};

const searchSql = extractTemplate(receiptSource, "AUTHORIZED_RECEIPT_SEARCH_SQL");
const pruneSql = extractTemplate(receiptSource, "PRUNE_UNAUTHORIZED_RECEIPTS_SQL");

const createDatabase = () => {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE receipt_summaries (
      organization_id TEXT NOT NULL, receipt_id TEXT NOT NULL, store_id TEXT NOT NULL,
      register_id TEXT NOT NULL, receipt_number INTEGER NOT NULL, issued_at TEXT NOT NULL,
      total_minor INTEGER NOT NULL, currency_code TEXT NOT NULL,
      payload_json TEXT NOT NULL, captured_at TEXT NOT NULL,
      PRIMARY KEY (organization_id, receipt_id)
    );
    CREATE TABLE outbox_events (event_id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, state TEXT NOT NULL);
    CREATE TABLE device_sync_state (organization_id TEXT, device_id TEXT, next_sequence INTEGER, server_checkpoint INTEGER);
    CREATE TABLE sync_cursors (organization_id TEXT, device_id TEXT, store_id TEXT, pull_cursor INTEGER);
    INSERT INTO outbox_events VALUES ('pending-sale', 'org-a', 'LOCAL_PENDING');
    INSERT INTO device_sync_state VALUES ('org-a', 'device-1', 12, 10);
    INSERT INTO sync_cursors VALUES ('org-a', 'device-1', 'store-a', 9);
  `);
  const insert = database.prepare("INSERT INTO receipt_summaries VALUES (?,?,?,?,?,?,?,?,?,?)");
  const addReceipt = (organizationId, receiptId, storeId, receiptNumber) => insert.run(
    organizationId, receiptId, storeId, `register-${storeId}`, receiptNumber,
    "2026-10-07T00:00:00.000Z", receiptNumber * 100, "PHP",
    JSON.stringify({ receipt_id: receiptId, store_id: storeId, receipt_number: receiptNumber }),
    "2026-10-07T00:00:00.000Z",
  );
  addReceipt("org-a", "receipt-a", "store-a", 101);
  addReceipt("org-a", "receipt-b", "store-b", 202);
  addReceipt("org-b", "receipt-foreign", "store-foreign", 303);
  return database;
};

const search = (database, organizationId, storeIds, query = "") => database
  .prepare(searchSql)
  .all(organizationId, JSON.stringify(storeIds), query, `%${query}%`, `%${query}%`, 25)
  .map((row) => JSON.parse(row.payload_json));

test("MOB-06 cached receipt reads deny same-organization cross-store and cross-tenant rows", () => {
  const database = createDatabase();
  assert.deepEqual(search(database, "org-a", ["store-a"]).map((row) => row.receipt_id), ["receipt-a"]);
  assert.deepEqual(search(database, "org-a", ["store-b"]).map((row) => row.receipt_id), ["receipt-b"]);
  assert.deepEqual(search(database, "org-a", []), []);
  assert.deepEqual(search(database, "org-b", ["store-a"]), []);
  assert.deepEqual(search(database, "org-b", ["store-foreign"]).map((row) => row.receipt_id), ["receipt-foreign"]);
});

test("MOB-06 assignment cleanup removes only inaccessible receipt cache", () => {
  const database = createDatabase();
  database.prepare(pruneSql).run("org-a", JSON.stringify(["store-a"]));

  assert.deepEqual(
    database.prepare("SELECT receipt_id FROM receipt_summaries WHERE organization_id='org-a' ORDER BY receipt_id").all().map((row) => row.receipt_id),
    ["receipt-a"],
  );
  assert.equal(database.prepare("SELECT count(*) count FROM receipt_summaries WHERE organization_id='org-b'").get().count, 1);
  assert.equal(database.prepare("SELECT state FROM outbox_events WHERE event_id='pending-sale'").get().state, "LOCAL_PENDING");
  assert.equal(database.prepare("SELECT next_sequence FROM device_sync_state").get().next_sequence, 12);
  assert.equal(database.prepare("SELECT server_checkpoint FROM device_sync_state").get().server_checkpoint, 10);
  assert.equal(database.prepare("SELECT pull_cursor FROM sync_cursors").get().pull_cursor, 9);
});

test("MOB-06 UI and context make current store scope mandatory", () => {
  assert.match(screenSource, /searchCachedReceiptSummaries\([\s\S]*?core\.organization\.id,[\s\S]*?core\.storeIds,[\s\S]*?query/);
  assert.match(contextSource, /pruneUnauthorizedReceiptSummaries\([\s\S]*?organizationId,[\s\S]*?next\.core\.storeIds/);
  assert.match(receiptSource, /if \(authorizedStoreIds\.length === 0\)/);
});
