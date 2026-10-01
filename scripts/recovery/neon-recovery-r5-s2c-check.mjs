import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const count = (source, pattern) => Array.from(source.matchAll(pattern)).length;
test("R5-S2C materially reduces Inventory-page core fan-out", () => {
  const inventory = read("src/app/(back-office)/back-office/inventory/page.tsx");
  const coreData = read("src/features/inventory/inventory-core-data.ts");
  const readModel = read("src/features/inventory/inventory-read-model.ts");
  const migration = read("database/migrations/0005_inventory_core_read_model_extension.sql");
  assert.ok(count(inventory, /\.from\s*\(/g) <= 32);
  assert.match(inventory, /loadInventoryControlCoreData/);
  assert.equal(count(coreData, /\.from\s*\(/g), 0);
  assert.match(coreData, /loadInventoryWorkspaceBundleResult/);
  for (const table of ["product_store_settings", "inventory_levels", "inventory_replenishment_rules", "inventory_policies", "inventory_policy_defaults", "inventory_adjustment_reasons", "offline_sync_events", "supply_chain_warehouses"]) assert.doesNotMatch(inventory, new RegExp(`from\\("${table}"\\)`));
  for (const need of ["movements", "activityProducts", "activityStores", "inventoryPolicies", "inventoryPolicyDefaults", "adjustmentReasons", "offlineInventoryIssues"]) {
    assert.match(readModel, new RegExp(`"${need}"`));
    assert.ok(migration.includes(`'${need}'`));
  }
  assert.match(migration, /security\s+invoker/i);
  assert.doesNotMatch(migration, /security\s+definer|auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.match(migration, /tindio_authenticated/i);
});
