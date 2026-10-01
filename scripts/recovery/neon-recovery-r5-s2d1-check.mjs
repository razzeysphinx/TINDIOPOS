import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const count = (source, pattern) => Array.from(source.matchAll(pattern)).length;

test("R5-S2D1 consolidates Purchasing table reads", () => {
  const inventory = read("src/app/(back-office)/back-office/inventory/page.tsx");
  const purchasingData = read("src/features/inventory/inventory-purchasing-data.ts");
  const migration = read("database/migrations/0006_inventory_purchasing_read_model.sql");

  assert.ok(
    count(inventory, /\.from\s*\(/g) <= 16,
    `Inventory page still has ${count(inventory, /\.from\s*\(/g)} static .from() matches; target is <= 16.`,
  );
  assert.equal(count(purchasingData, /\.from\s*\(/g), 0);
  assert.equal(count(purchasingData, /\.rpc\s*\(/g), 1);
  assert.match(purchasingData, /get_inventory_purchasing_bundle_v1/);

  for (const directPurchasingRead of [
    /\.from\("product_units"\)/,
    /\.from\("suppliers"\)/,
    /\.from\("purchase_orders"\)/,
    /\.from\("purchase_order_lines"\)/,
    /\.from\("goods_receipts"\)/,
    /\.from\("goods_receipt_lines"\)/,
  ]) assert.doesNotMatch(inventory, directPurchasingRead);

  assert.match(inventory, /get_purchase_order_line_costs/);
  assert.match(migration, /get_inventory_purchasing_bundle_v1/i);
  assert.match(migration, /security\s+invoker/i);
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.doesNotMatch(migration, /auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.match(migration, /tindio_authenticated/i);
});
