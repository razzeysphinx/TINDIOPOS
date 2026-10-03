import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(ROOT, path), "utf8");
const count = (source, pattern) => Array.from(source.matchAll(pattern)).length;

test("R5-S2B moves Replenishment database reads behind the server read model", () => {
  const page = read("src/app/(back-office)/back-office/replenishment/page.tsx");
  const loader = read("src/features/inventory/replenishment-data.ts");
  const readModel = read("src/features/inventory/inventory-read-model.ts");
  const migration = read("database/migrations/0004_inventory_replenishment_read_models.sql");

  assert.equal(count(page, /\.from\s*\(/g), 0, "Replenishment page must contain zero direct table reads.");
  assert.equal(count(page, /\.rpc\s*\(/g), 0, "Replenishment page must contain zero direct RPC calls.");
  assert.equal(count(page, /\bcreateClient\s*\(/g), 0, "Replenishment page must not create a database client.");
  assert.match(page, /loadReplenishmentWorkspaceData/);
  assert.equal(count(loader, /\.from\s*\(/g), 0, "Replenishment loader must not fan out into direct table reads.");
  assert.ok(count(loader, /\.rpc\s*\(/g) <= 1, "Replenishment loader may contain only the stock-page RPC call site.");
  assert.match(loader, /loadInventoryWorkspaceBundleResult/);
  assert.equal(count(readModel, /\.from\s*\(/g), 0, "Shared read model must use RPC, not recreate table-read fan-out.");
  assert.match(readModel, /get_inventory_workspace_bundle_v1/);
  assert.match(migration, /get_inventory_workspace_bundle_v1/i);
  assert.match(migration, /security\s+invoker/i);
  assert.doesNotMatch(migration, /security\s+definer/i);
  assert.doesNotMatch(migration, /auth\.(uid|jwt|role|user_id)\s*\(/i);
  assert.match(migration, /tindio_authenticated/i);

  for (const key of [
    "stores", "categories", "products", "variants", "productStoreSettings", "inventoryLevels", "warehouses", "replenishmentRules",
    "stockRequests", "stockRequestLines", "stockRequestDiscrepancies", "requestStockTransfers", "receivableStockTransfers", "stockTransferLines",
    "suppliers", "openPurchaseOrders", "openPurchaseOrderLines", "archivedProductCount",
  ]) {
    assert.ok(readModel.includes(key), `Read model is missing required Replenishment key: ${key}`);
  }
});
