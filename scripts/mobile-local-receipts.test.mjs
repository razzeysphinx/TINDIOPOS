import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const read = (path) => fs.readFileSync(path, "utf8");
const schemaSource = read("apps/mobile/src/db/schema.ts");
const receiptSource = read("apps/mobile/src/db/local-receipts.ts");
const acceptanceSource = read("apps/mobile/src/features/outbox/create-offline-sale.ts");
const outboxSource = read("apps/mobile/src/db/outbox.ts");
const syncSource = read("apps/mobile/src/features/outbox/outbox-sync.ts");
const cacheSource = read("apps/mobile/src/db/cache-admin.ts");
const detailSource = read("apps/mobile/app/(app)/local-receipt/[eventId].tsx");

function templateAfter(source, marker) {
  const markerAt = source.indexOf(marker);
  assert.notEqual(markerAt, -1, `Missing ${marker}`);
  const start = source.indexOf("`", markerAt);
  const end = source.indexOf("`", start + 1);
  assert.ok(start > markerAt && end > start, `Missing SQL template for ${marker}`);
  return source.slice(start + 1, end);
}

const migrationSql = templateAfter(schemaSource, 'name: "mob_07_immutable_local_receipts"');
const searchSql = templateAfter(receiptSource, "LOCAL_RECEIPT_SEARCH_SQL");
const detailSql = templateAfter(receiptSource, "LOCAL_RECEIPT_DETAIL_SQL");
const historySql = templateAfter(receiptSource, "RECEIPT_COPY_HISTORY_SQL");
const localInsertSql = templateAfter(outboxSource, "LOCAL_RECEIPT_INSERT_SQL");
const officialLinkSql = templateAfter(outboxSource, "OFFICIAL_RECEIPT_LINK_SQL");
const outboxAckSql = templateAfter(outboxSource, "OUTBOX_SYNC_ACK_SQL");

const v1 = {
  version: 1, capturedAt: "2026-10-08T00:00:00.000Z", organizationId: "org-a",
  storeId: "store-a", registerId: "register-a", shiftId: "shift-a", deviceId: "device-a",
  employeeId: "employee-a", employeeName: "Old Cashier", currencyCode: "PHP",
  localReceiptReference: "OFF-LEGACY", subtotalMinor: 100, discountMinor: 0, taxMinor: 0,
  totalMinor: 100, tenderedMinor: 100, changeMinor: 0, itemCount: 1,
};

const v2 = {
  ...v1, version: 2, localReceiptReference: "OFF-ITEMIZED", organizationName: "Tindio Demo",
  storeName: "Main Store", registerName: "Counter 1",
  discount: { id: "discount-a", name: "Launch discount" },
  tax: { id: "tax-a", name: "VAT", rateBps: 1200, isInclusive: true },
  payment: { methodId: "cash-a", methodName: "Cash", methodType: "CASH" },
  subtotalMinor: 550, discountMinor: 50, taxMinor: 54, totalMinor: 500,
  tenderedMinor: 1000, changeMinor: 500, itemCount: 2,
  lines: [{ lineNumber: 1, productId: "product-a", variantId: "variant-a", productName: "Original Tea",
    variantName: "Large", sku: "TEA-L", barcode: "10001", unit: "cup", quantity: 2,
    unitPriceMinor: 275, modifierTotalMinor: 0, lineTotalMinor: 550 }],
};

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  database.exec(`
    CREATE TABLE outbox_events (
      event_id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL, store_id TEXT NOT NULL,
      register_id TEXT NOT NULL, device_id TEXT NOT NULL, device_sequence INTEGER NOT NULL,
      shift_id TEXT NOT NULL, operation_type TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      local_reference TEXT NOT NULL, payload_json TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL, last_attempt_at TEXT, next_retry_at TEXT, synced_at TEXT,
      last_error TEXT, conflict_type TEXT, server_sale_id TEXT, official_receipt_number INTEGER
    );
    CREATE TABLE device_sync_state (organization_id TEXT,device_id TEXT,next_sequence INTEGER,server_checkpoint INTEGER);
    CREATE TABLE sync_cursors (organization_id TEXT,device_id TEXT,store_id TEXT,pull_cursor INTEGER);
    CREATE TABLE device_credentials (organization_id TEXT,device_id TEXT,secret_marker TEXT);
  `);
  const insert = database.prepare(`INSERT INTO outbox_events
    (event_id,organization_id,store_id,register_id,device_id,device_sequence,shift_id,operation_type,idempotency_key,local_reference,payload_json,snapshot_json,state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run("legacy", "org-a", "store-a", "register-a", "device-a", 7, "shift-a", "SALE_COMPLETED",
    "checkout-key-legacy", "OFF-LEGACY", "{}", JSON.stringify(v1), "LOCAL_PENDING", v1.capturedAt, v1.capturedAt);
  database.exec("INSERT INTO device_sync_state VALUES ('org-a','device-a',8,6)");
  database.exec("INSERT INTO sync_cursors VALUES ('org-a','device-a','store-a',41)");
  database.exec("INSERT INTO device_credentials VALUES ('org-a','device-a','preserved')");
  database.exec(migrationSql);
  return { database, insert };
}

test("MOB-07 migration backfills legacy receipts without inventing lines or disturbing custody", () => {
  const { database } = createDatabase();
  const receipt = database.prepare("SELECT * FROM local_receipts WHERE event_id='legacy'").get();
  assert.equal(receipt.snapshot_version, 1);
  assert.deepEqual(JSON.parse(receipt.snapshot_json), v1);
  assert.equal(database.prepare("SELECT idempotency_key FROM outbox_events").get().idempotency_key, "checkout-key-legacy");
  assert.equal(database.prepare("SELECT next_sequence FROM device_sync_state").get().next_sequence, 8);
  assert.equal(database.prepare("SELECT pull_cursor FROM sync_cursors").get().pull_cursor, 41);
  assert.equal(database.prepare("SELECT secret_marker FROM device_credentials").get().secret_marker, "preserved");
});

test("MOB-07 itemized snapshot remains exact after catalog rename, repricing, and deletion", () => {
  const { database, insert } = createDatabase();
  database.exec("CREATE TABLE catalog_items (product_id TEXT PRIMARY KEY,product_name TEXT,price_minor INTEGER)");
  database.exec("INSERT INTO catalog_items VALUES ('product-a','Original Tea',275)");
  database.exec("BEGIN IMMEDIATE");
  insert.run("itemized", "org-a", "store-a", "register-a", "device-a", 8, "shift-a", "SALE_COMPLETED",
    "checkout-key-itemized", "OFF-ITEMIZED", "{}", JSON.stringify(v2), "LOCAL_PENDING", v2.capturedAt, v2.capturedAt);
  database.prepare(localInsertSql)
    .run("itemized", "org-a", "store-a", "register-a", "OFF-ITEMIZED", 2, JSON.stringify(v2), v2.capturedAt);
  database.exec("COMMIT");
  database.exec("UPDATE catalog_items SET product_name='Renamed Tea',price_minor=999; DELETE FROM catalog_items");

  const saved = JSON.parse(database.prepare("SELECT snapshot_json FROM local_receipts WHERE event_id='itemized'").get().snapshot_json);
  assert.deepEqual(saved.lines, v2.lines);
  assert.equal(saved.discount.name, "Launch discount");
  assert.equal(saved.tax.name, "VAT");
  assert.equal(saved.payment.methodName, "Cash");
  assert.throws(() => database.exec("UPDATE local_receipts SET snapshot_json='{}' WHERE event_id='itemized'"), /immutable/);
  assert.throws(() => database.exec("DELETE FROM local_receipts WHERE event_id='itemized'"), /custody/);
});

test("MOB-07 official mapping is unique, immutable, and copy jobs have separate identities", () => {
  const { database, insert } = createDatabase();
  insert.run("itemized", "org-a", "store-a", "register-a", "device-a", 8, "shift-a", "SALE_COMPLETED",
    "checkout-key-itemized", "OFF-ITEMIZED", "{}", JSON.stringify(v2), "LOCAL_PENDING", v2.capturedAt, v2.capturedAt);
  database.prepare(localInsertSql)
    .run("itemized", "org-a", "store-a", "register-a", "OFF-ITEMIZED", 2, JSON.stringify(v2), v2.capturedAt);
  database.prepare("INSERT INTO receipt_copy_jobs VALUES (?,?,?,?,?,'PREPARED',?,?,?,NULL,NULL)")
    .run("copy-before-ack", "org-a", "itemized", 1, "PROVISIONAL", "profile-a", "employee-a", "2026-10-08T00:01:00Z");
  database.exec("BEGIN IMMEDIATE");
  assert.equal(database.prepare(officialLinkSql)
    .run("sale-server-a", 501, "2026-10-08T00:02:00Z", "org-a", "itemized").changes, 1);
  assert.equal(database.prepare(outboxAckSql)
    .run("2026-10-08T00:02:00Z", "sale-server-a", 501, "2026-10-08T00:02:00Z", "org-a", "itemized").changes, 1);
  database.exec("COMMIT");
  assert.equal(database.prepare(officialLinkSql)
    .run("sale-server-b", 502, "2026-10-08T00:03:00Z", "org-a", "itemized").changes, 0);
  assert.throws(() => database.prepare("UPDATE local_receipts SET server_sale_id=?,official_receipt_number=?,linked_at=? WHERE event_id=?")
    .run("sale-server-b", 502, "2026-10-08T00:03:00Z", "itemized"), /immutable/);
  database.prepare("INSERT INTO receipt_copy_jobs VALUES (?,?,?,?,?,'PREPARED',?,?,?,NULL,NULL)")
    .run("copy-after-ack", "org-a", "itemized", 2, "OFFICIAL", "profile-a", "employee-a", "2026-10-08T00:04:00Z");
  const jobs = database.prepare(historySql).all("org-a", "itemized", JSON.stringify(["store-a"]));
  assert.deepEqual(jobs.map((job) => [job.job_id, job.copy_number, job.document_kind]), [
    ["copy-after-ack", 2, "OFFICIAL"], ["copy-before-ack", 1, "PROVISIONAL"],
  ]);
  assert.equal(database.prepare("SELECT idempotency_key FROM outbox_events WHERE event_id='itemized'").get().idempotency_key, "checkout-key-itemized");
  assert.deepEqual({ ...database.prepare("SELECT state,server_sale_id,official_receipt_number FROM outbox_events WHERE event_id='itemized'").get() }, {
    state: "SYNCED", server_sale_id: "sale-server-a", official_receipt_number: 501,
  });
});

test("MOB-07 local receipt and copy reads enforce tenant and assigned-store scope", () => {
  const { database } = createDatabase();
  const search = (organizationId, stores) => database.prepare(searchSql)
    .all(organizationId, JSON.stringify(stores), "", "%%", "%%", "%%", 25);
  assert.equal(search("org-a", ["store-a"]).length, 1);
  assert.equal(search("org-a", ["store-b"]).length, 0);
  assert.equal(search("org-b", ["store-a"]).length, 0);
  assert.equal(database.prepare(detailSql).get("org-a", "legacy", JSON.stringify(["store-b"])), undefined);
  assert.deepEqual(database.prepare(historySql).all("org-a", "legacy", JSON.stringify(["store-b"])), []);
});

test("MOB-07 product wiring uses v2 committed data and never treats copy preparation as printing", () => {
  for (const field of ["productName", "variantName", "sku", "barcode", "unit", "quantity", "unitPriceMinor", "lineTotalMinor", "discount", "tax", "payment"]) {
    assert.ok(acceptanceSource.includes(field), `Missing committed field ${field}`);
  }
  assert.match(outboxSource, /INSERT INTO local_receipts/);
  const enqueueBody = outboxSource.slice(outboxSource.indexOf("export async function enqueueSaleCompletedEvent"));
  assert.ok(enqueueBody.indexOf("INSERT INTO outbox_events") < enqueueBody.indexOf("LOCAL_RECEIPT_INSERT_SQL"));
  assert.ok(enqueueBody.indexOf("LOCAL_RECEIPT_INSERT_SQL") < enqueueBody.indexOf("next_sequence=next_sequence+1"));
  assert.match(syncSource, /markOutboxEventSynced/);
  assert.doesNotMatch(cacheSource, /ORGANIZATION_TABLES[^\n]*local_receipts/);
  assert.match(cacheSource, /local_receipts, receipt_copy_jobs/);
  assert.match(detailSource, /No physical printer adapter is configured/);
  assert.match(detailSource, /PROVISIONAL SALE RECORD — NOT AN OFFICIAL RECEIPT/);
});
