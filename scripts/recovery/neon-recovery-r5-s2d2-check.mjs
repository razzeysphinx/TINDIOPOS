import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const count = (source, pattern) => Array.from(source.matchAll(pattern)).length;

test("R5-S2D2 removes remaining ordinary Inventory table-read fan-out", () => {
  const inventory = read("src/app/(back-office)/back-office/inventory/page.tsx");
  const specialized = read("src/features/inventory/inventory-specialized-data.ts");
  const migration = read("database/migrations/0007_inventory_specialized_read_models.sql");
  assert.ok(count(inventory, /\.from\s*\(/g) <= 1);
  for (const table of ["inventory_movements", "products", "product_variants", "stores", "employees", "profiles", "refunds", "receipts", "inventory_adjustments", "inventory_counts", "stock_transfers", "supplier_returns", "production_runs"]) assert.doesNotMatch(inventory, new RegExp(`\\.from\\("${table}"\\)`));
  assert.equal(count(specialized, /\.from\s*\(/g), 0);
  assert.equal(count(specialized, /\.rpc\s*\(/g), 2);
  assert.match(specialized, /get_inventory_valuation_reference_bundle_v1/);
  assert.match(specialized, /get_inventory_activity_reference_bundle_v1/);
  assert.match(inventory, /get_inventory_valuation/);
  assert.match(inventory, /get_inventory_movement_costs/);
  assert.match(migration, /get_inventory_valuation_reference_bundle_v1/i);
  assert.match(migration, /get_inventory_activity_reference_bundle_v1/i);
  assert.doesNotMatch(migration, /security\s+definer|auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.equal(count(migration, /security\s+invoker/gi), 2);
  assert.match(migration, /tindio_authenticated/i);
});
