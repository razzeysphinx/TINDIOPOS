import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const source = fs.readFileSync("apps/mobile/src/db/sync-resnapshot.ts", "utf8");
const pullSource = fs.readFileSync("apps/mobile/src/features/sync/pull-deltas.ts", "utf8");
const apiSource = fs.readFileSync("apps/mobile/src/lib/tindio-api.ts", "utf8");
const routeSource = fs.readFileSync("src/app/api/pos/v2/sync/pull/route.ts", "utf8");
const migration = fs.readFileSync("database/migrations/0016_mobile_sync_retention_resnapshot.sql", "utf8");
const catalogSource = fs.readFileSync("apps/mobile/src/db/catalog-cache.ts", "utf8");

function stringConstant(name) {
  const match = source.match(new RegExp(`export const ${name} = ("(?:[^"\\\\]|\\\\.)*");`));
  assert.ok(match, `missing ${name}`);
  return JSON.parse(match[1]);
}

function templateConstant(name) {
  const marker = `export const ${name}`;
  const start = catalogSource.indexOf(marker);
  assert.notEqual(start, -1);
  const first = catalogSource.indexOf("`", start);
  const last = catalogSource.indexOf("`", first + 1);
  return catalogSource.slice(first + 1, last);
}

const sql = {
  deleteCatalog: stringConstant("RESNAPSHOT_DELETE_CATALOG_SQL"),
  deleteCustomers: stringConstant("RESNAPSHOT_DELETE_CUSTOMERS_SQL"),
  deleteModifiers: stringConstant("RESNAPSHOT_DELETE_MODIFIERS_SQL"),
  reference: stringConstant("RESNAPSHOT_REFERENCE_SQL"),
  cacheState: stringConstant("RESNAPSHOT_CACHE_STATE_SQL"),
  cursor: stringConstant("RESNAPSHOT_CURSOR_SQL"),
  catalog: templateConstant("CATALOG_ITEM_UPSERT_SQL"),
};

function database() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE catalog_items (organization_id TEXT,store_id TEXT,item_key TEXT,product_id TEXT,variant_id TEXT,category_id TEXT,product_name TEXT,variant_name TEXT,sku TEXT,barcode TEXT,price_minor INTEGER,unit TEXT,image_url TEXT,is_variable_price INTEGER,allow_fractional_quantity INTEGER,has_modifiers INTEGER,payload_json TEXT,captured_at TEXT,search_text TEXT,PRIMARY KEY(organization_id,store_id,item_key));
    CREATE TABLE customer_cache (organization_id TEXT,store_id TEXT,customer_id TEXT);
    CREATE TABLE modifier_snapshots (organization_id TEXT,store_id TEXT,product_id TEXT);
    CREATE TABLE reference_snapshots (organization_id TEXT PRIMARY KEY,reference_version TEXT,payload_json TEXT,captured_at TEXT);
    CREATE TABLE local_cache_state (organization_id TEXT,domain TEXT,store_id TEXT,scope_key TEXT,source_version TEXT,record_count INTEGER,is_complete INTEGER,captured_at TEXT,PRIMARY KEY(organization_id,domain,store_id,scope_key));
    CREATE TABLE sync_cursors (organization_id TEXT,device_id TEXT,store_id TEXT,pull_cursor INTEGER,initialized INTEGER,last_pull_at TEXT,last_error TEXT,PRIMARY KEY(organization_id,device_id,store_id));
    CREATE TABLE outbox_events (event_id TEXT PRIMARY KEY,state TEXT,idempotency_key TEXT,device_sequence INTEGER);
    CREATE TABLE device_sync_state (organization_id TEXT,device_id TEXT,next_sequence INTEGER,server_checkpoint INTEGER);
    CREATE TABLE checkout_intents (intent_id TEXT PRIMARY KEY,state TEXT,idempotency_key TEXT);
    CREATE TABLE local_receipts (event_id TEXT PRIMARY KEY,snapshot_json TEXT);
    CREATE TABLE outbox_recovery_actions (action_id INTEGER PRIMARY KEY,event_id TEXT);
    CREATE TABLE shift_finalization_guards (shift_id TEXT PRIMARY KEY,state TEXT);
    INSERT INTO catalog_items VALUES ('org','store','stale:simple','stale',NULL,NULL,'Stale',NULL,NULL,NULL,100,'each',NULL,0,0,0,'{}','old','stale');
    INSERT INTO customer_cache VALUES ('org','store','customer-stale');
    INSERT INTO modifier_snapshots VALUES ('org','store','stale');
    INSERT INTO reference_snapshots VALUES ('org','old','{}','old');
    INSERT INTO sync_cursors VALUES ('org','device','store',10,1,'old',NULL);
    INSERT INTO outbox_events VALUES ('event','LOCAL_PENDING','stable-key',7);
    INSERT INTO device_sync_state VALUES ('org','device',8,6);
    INSERT INTO checkout_intents VALUES ('intent','UNKNOWN','intent-key');
    INSERT INTO local_receipts VALUES ('event','{"totalMinor":250}');
    INSERT INTO outbox_recovery_actions VALUES (1,'event');
    INSERT INTO shift_finalization_guards VALUES ('shift','BLOCKED');
  `);
  return db;
}

function replace(db, failBeforeCursor = false) {
  const at = "2026-10-12T12:00:00.000Z";
  const item = { productId: "current", variantId: null, categoryId: "cat", productName: "Current", variantName: null, sku: "NEW", barcode: "2901", priceMinor: 250, unit: "each", imageUrl: null, isVariablePrice: false, allowFractionalQuantity: false, hasModifiers: false };
  db.exec("BEGIN EXCLUSIVE");
  try {
    db.prepare(sql.deleteCatalog).run("org", "store");
    db.prepare(sql.catalog).run("org", "store", "current:simple", item.productId, item.variantId, item.categoryId, item.productName, item.variantName, item.sku, item.barcode, item.priceMinor, item.unit, item.imageUrl, 0, 0, 0, JSON.stringify(item), at, "current new 2901");
    db.prepare(sql.deleteCustomers).run("org", "store");
    db.prepare(sql.deleteModifiers).run("org", "store");
    db.prepare(sql.reference).run("org", "v2", '{"categories":[]}', at);
    db.prepare(sql.cacheState).run("org", "catalog", "store", "offline-prime", "50", 1, 1, at);
    db.prepare(sql.cacheState).run("org", "reference", "", "default", "v2", 1, 1, at);
    db.prepare(sql.cacheState).run("org", "customers", "store", "observed", "50", 0, 0, at);
    if (failBeforeCursor) throw new Error("injected failure");
    db.prepare(sql.cursor).run(50, at, "org", "device", "store");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

test("A29 controlled resnapshot atomically replaces stale caches and advances the cursor last", () => {
  const db = database();
  replace(db);
  assert.deepEqual({ ...db.prepare("SELECT product_id,sku,barcode FROM catalog_items").get() }, { product_id: "current", sku: "NEW", barcode: "2901" });
  assert.equal(db.prepare("SELECT count(*) count FROM customer_cache").get().count, 0);
  assert.equal(db.prepare("SELECT count(*) count FROM modifier_snapshots").get().count, 0);
  assert.deepEqual({ ...db.prepare("SELECT pull_cursor,initialized,last_error FROM sync_cursors").get() }, { pull_cursor: 50, initialized: 1, last_error: null });
  assert.equal(db.prepare("SELECT reference_version FROM reference_snapshots").get().reference_version, "v2");
  assert.deepEqual({ ...db.prepare("SELECT event_id,state,idempotency_key,device_sequence FROM outbox_events").get() }, { event_id: "event", state: "LOCAL_PENDING", idempotency_key: "stable-key", device_sequence: 7 });
  assert.deepEqual({ ...db.prepare("SELECT next_sequence,server_checkpoint FROM device_sync_state").get() }, { next_sequence: 8, server_checkpoint: 6 });
  assert.equal(db.prepare("SELECT state FROM checkout_intents").get().state, "UNKNOWN");
  assert.equal(db.prepare("SELECT snapshot_json FROM local_receipts").get().snapshot_json, '{"totalMinor":250}');
  assert.equal(db.prepare("SELECT count(*) count FROM outbox_recovery_actions").get().count, 1);
  assert.equal(db.prepare("SELECT state FROM shift_finalization_guards").get().state, "BLOCKED");
});

test("A29 failed replacement rolls back cache edits and never advances the cursor", () => {
  const db = database();
  assert.throws(() => replace(db, true), /injected failure/);
  assert.equal(db.prepare("SELECT product_id FROM catalog_items").get().product_id, "stale");
  assert.equal(db.prepare("SELECT customer_id FROM customer_cache").get().customer_id, "customer-stale");
  assert.equal(db.prepare("SELECT pull_cursor FROM sync_cursors").get().pull_cursor, 10);
  assert.equal(db.prepare("SELECT state FROM outbox_events").get().state, "LOCAL_PENDING");
});

test("A29 transport fails closed for old clients and validates scope before applying a resnapshot", () => {
  assert.match(routeSource, /parsed\.data\.cursor < retainedAfterRevision/);
  assert.match(routeSource, /status: 409/);
  assert.match(routeSource, /code: "SYNC_CURSOR_EXPIRED"/);
  assert.match(apiSource, /response\.status === 409/);
  assert.match(pullSource, /RESNAPSHOT_SCOPE_MISMATCH/);
  assert.match(pullSource, /INVALID_RESNAPSHOT_BOUNDARY/);
  assert.ok(pullSource.indexOf("const page=await pullPosV2Delta") < pullSource.indexOf("const snapshot=await fetchPosV2SyncResnapshot"));
  assert.match(migration, /revoke execute on function private\.prune_pos_sync_changes\(uuid, bigint\) from public, anon, authenticated, service_role, tindio_authenticated/);
  assert.match(migration, /grant execute on function public\.get_pos_sync_resnapshot_v1\(uuid, uuid\) to tindio_authenticated/);
  assert.match(migration, /greatest\(private\.pos_sync_retention_state\.retained_after_revision, excluded\.retained_after_revision\)/);
});

test("A29 resnapshot never deletes financial custody or device sequence state", () => {
  for (const table of ["outbox_events", "device_sync_state", "checkout_intents", "local_receipts", "outbox_recovery_actions", "shift_finalization_guards"]) {
    assert.doesNotMatch(source, new RegExp(`DELETE FROM ${table}`));
  }
  assert.ok(source.indexOf("withExclusiveTransactionAsync") < source.lastIndexOf("RESNAPSHOT_CURSOR_SQL"));
});
