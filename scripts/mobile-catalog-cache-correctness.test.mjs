import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const catalogSource = fs.readFileSync("apps/mobile/src/db/catalog-cache.ts", "utf8");
const schemaSource = fs.readFileSync("apps/mobile/src/db/schema.ts", "utf8");

const extractTemplate = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Missing ${marker}`);
  const templateStart = source.indexOf("`", start);
  const templateEnd = source.indexOf("`", templateStart + 1);
  assert.notEqual(templateStart, -1, `Missing SQL start for ${marker}`);
  assert.notEqual(templateEnd, -1, `Missing SQL end for ${marker}`);
  return source.slice(templateStart + 1, templateEnd);
};

const upsertSql = extractTemplate(catalogSource, "CATALOG_ITEM_UPSERT_SQL");
const repairSql = extractTemplate(schemaSource, 'name: "mob_05_catalog_cache_repair"');

const createCatalogSchema = (database) => database.exec(`
  CREATE TABLE catalog_items (
    organization_id TEXT NOT NULL, store_id TEXT NOT NULL, item_key TEXT NOT NULL,
    product_id TEXT NOT NULL, variant_id TEXT, category_id TEXT,
    product_name TEXT NOT NULL, variant_name TEXT, sku TEXT, barcode TEXT,
    price_minor INTEGER NOT NULL, unit TEXT NOT NULL, image_url TEXT,
    is_variable_price INTEGER NOT NULL CHECK (is_variable_price IN (0, 1)),
    allow_fractional_quantity INTEGER NOT NULL CHECK (allow_fractional_quantity IN (0, 1)),
    has_modifiers INTEGER NOT NULL CHECK (has_modifiers IN (0, 1)),
    payload_json TEXT NOT NULL, captured_at TEXT NOT NULL,
    search_text TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (organization_id, store_id, item_key)
  );
  CREATE INDEX idx_catalog_lookup_barcode ON catalog_items (organization_id, store_id, barcode);
  CREATE INDEX idx_catalog_lookup_sku ON catalog_items (organization_id, store_id, sku);
  CREATE INDEX idx_catalog_category ON catalog_items (organization_id, store_id, category_id);
  CREATE INDEX idx_catalog_product_name ON catalog_items (organization_id, store_id, product_name COLLATE NOCASE);
  CREATE INDEX idx_catalog_search_text ON catalog_items (organization_id, store_id, search_text);
`);

const params = (item, capturedAt) => [
  "org-a", "store-a", "product-1:variant-1", item.productId, item.variantId,
  item.categoryId, item.productName, item.variantName, item.sku, item.barcode,
  item.priceMinor, item.unit, item.imageUrl, item.isVariablePrice ? 1 : 0,
  item.allowFractionalQuantity ? 1 : 0, item.hasModifiers ? 1 : 0,
  JSON.stringify(item), capturedAt,
  [item.productName, item.variantName, item.sku, item.barcode].filter(Boolean).join(" ").toLocaleLowerCase(),
];

const oldItem = {
  productId: "product-1", variantId: "variant-1", categoryId: "category-old",
  productName: "Old Product", variantName: "Old Variant", sku: "SKU-OLD",
  barcode: "old-barcode", priceMinor: 100, unit: "each", imageUrl: "old.png",
  isVariablePrice: false, allowFractionalQuantity: false, hasModifiers: false,
};

const newItem = {
  productId: "product-1", variantId: "variant-1", categoryId: "category-new",
  productName: "New Product", variantName: "New Variant", sku: "SKU-NEW",
  barcode: "new-barcode", priceMinor: 275, unit: "kg", imageUrl: "new.png",
  isVariablePrice: true, allowFractionalQuantity: true, hasModifiers: true,
};

test("MOB-05 upsert replaces every canonical lookup and display scalar", () => {
  const database = new DatabaseSync(":memory:");
  createCatalogSchema(database);
  const upsert = database.prepare(upsertSql);
  upsert.run(...params(oldItem, "2026-10-07T00:00:00.000Z"));
  upsert.run(...params(newItem, "2026-10-07T00:01:00.000Z"));

  const row = database.prepare("SELECT * FROM catalog_items").get();
  assert.deepEqual(
    {
      product_id: row.product_id, variant_id: row.variant_id, category_id: row.category_id,
      product_name: row.product_name, variant_name: row.variant_name, sku: row.sku,
      barcode: row.barcode, price_minor: row.price_minor, unit: row.unit,
      image_url: row.image_url, is_variable_price: row.is_variable_price,
      allow_fractional_quantity: row.allow_fractional_quantity, has_modifiers: row.has_modifiers,
      captured_at: row.captured_at, search_text: row.search_text,
    },
    {
      product_id: "product-1", variant_id: "variant-1", category_id: "category-new",
      product_name: "New Product", variant_name: "New Variant", sku: "SKU-NEW",
      barcode: "new-barcode", price_minor: 275, unit: "kg", image_url: "new.png",
      is_variable_price: 1, allow_fractional_quantity: 1, has_modifiers: 1,
      captured_at: "2026-10-07T00:01:00.000Z",
      search_text: "new product new variant sku-new new-barcode",
    },
  );
  assert.deepEqual(JSON.parse(row.payload_json), newItem);

  for (const [column, oldValue, newValue] of [
    ["barcode", "old-barcode", "new-barcode"],
    ["sku", "SKU-OLD", "SKU-NEW"],
    ["category_id", "category-old", "category-new"],
    ["product_name", "Old Product", "New Product"],
  ]) {
    assert.equal(database.prepare(`SELECT count(*) AS count FROM catalog_items WHERE ${column}=?`).get(oldValue).count, 0);
    assert.equal(database.prepare(`SELECT count(*) AS count FROM catalog_items WHERE ${column}=?`).get(newValue).count, 1);
  }
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_items WHERE search_text LIKE ?").get("new product%").count, 1);
  assert.equal(database.prepare("SELECT count(*) AS count FROM catalog_items WHERE search_text LIKE ?").get("old product%").count, 0);
});

test("MOB-05 migration repairs stale installed rows without touching transaction custody", () => {
  const database = new DatabaseSync(":memory:");
  createCatalogSchema(database);
  database.exec(`
    CREATE TABLE outbox_events (event_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL);
    CREATE TABLE device_sync_state (organization_id TEXT, device_id TEXT, next_sequence INTEGER, server_checkpoint INTEGER);
    CREATE TABLE sync_cursors (organization_id TEXT, device_id TEXT, store_id TEXT, pull_cursor INTEGER);
    INSERT INTO outbox_events VALUES ('event-1', '{"amount":275}');
    INSERT INTO device_sync_state VALUES ('org-a', 'device-1', 42, 40);
    INSERT INTO sync_cursors VALUES ('org-a', 'device-1', 'store-a', 19);
  `);
  const upsert = database.prepare(upsertSql);
  upsert.run(...params(oldItem, "2026-10-07T00:00:00.000Z"));
  database.prepare("UPDATE catalog_items SET payload_json=?, captured_at=?, search_text=?").run(
    JSON.stringify(newItem), "2026-10-07T00:01:00.000Z", "new product new variant sku-new new-barcode",
  );

  database.exec("BEGIN EXCLUSIVE");
  database.exec(repairSql);
  database.exec("PRAGMA user_version = 8");
  database.exec("COMMIT");

  const repaired = database.prepare("SELECT * FROM catalog_items").get();
  assert.equal(repaired.barcode, "new-barcode");
  assert.equal(repaired.sku, "SKU-NEW");
  assert.equal(repaired.category_id, "category-new");
  assert.equal(repaired.product_name, "New Product");
  assert.equal(repaired.variant_name, "New Variant");
  assert.equal(repaired.price_minor, 275);
  assert.equal(repaired.unit, "kg");
  assert.equal(repaired.is_variable_price, 1);
  assert.equal(repaired.allow_fractional_quantity, 1);
  assert.equal(repaired.has_modifiers, 1);
  assert.equal(repaired.search_text, "new product new variant sku-new new-barcode");
  assert.equal(database.prepare("PRAGMA user_version").get().user_version, 8);

  const outbox = database.prepare("SELECT * FROM outbox_events").get();
  assert.equal(outbox.event_id, "event-1");
  assert.equal(outbox.payload_json, '{"amount":275}');
  assert.equal(database.prepare("SELECT next_sequence FROM device_sync_state").get().next_sequence, 42);
  assert.equal(database.prepare("SELECT server_checkpoint FROM device_sync_state").get().server_checkpoint, 40);
  assert.equal(database.prepare("SELECT pull_cursor FROM sync_cursors").get().pull_cursor, 19);
});
