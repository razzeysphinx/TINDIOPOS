import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 7 makes the approval-aware replenishment workflow the primary transfer path", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");
  const workspace = await source("src/features/inventory/inventory-transfer-workspace.tsx");

  assert.match(inventoryPage, /InventoryTransferWorkspace/);
  assert.match(inventoryPage, /awaitingReceiptCount=\{inTransitTransfers\.length\}/);
  assert.doesNotMatch(inventoryPage, /sections=\{\["transfers"\]\}/);
  assert.match(workspace, /Open restock items/);
  assert.match(workspace, /Requested/);
  assert.match(workspace, /Approved & picked/);
  assert.match(workspace, /In transit/);
  assert.match(workspace, /Destination balances remain unchanged until receipt/);
});

test("Phase 7 keeps replenishment suggestions source-aware and non-automatic", async () => {
  const workflow = await source("src/features/inventory/supply-chain-workflows.tsx");

  assert.match(workflow, /function ReplenishmentRecommendations/);
  assert.match(workflow, /Suggested transfer source/);
  assert.match(workflow, /Prepare transfer request/);
  assert.match(workflow, /Plan supplier purchase/);
  assert.match(workflow, /never create a transfer or purchase order automatically/);
  assert.match(workflow, /if \(!rule\.preferredWarehouseId\) return/);
});

test("Phase 7 preserves the existing bounded, permission-gated transfer RPC lifecycle", async () => {
  const actions = await source("src/features/inventory/supply-chain-actions.ts");
  const legacyActions = await source("src/features/inventory/advanced-inventory-actions.ts");

  assert.match(actions, /requireSupplyChainManager\(\)/);
  assert.match(actions, /rpc\("create_stock_request"/);
  assert.match(actions, /rpc\("approve_stock_request"/);
  assert.match(actions, /rpc\("start_stock_request_picking"/);
  assert.match(actions, /rpc\("dispatch_stock_request"/);
  assert.match(actions, /rpc\("receive_stock_request"/);
  assert.match(legacyActions, /rpc\("receive_stock_transfer"/);
  assert.doesNotMatch(actions, /from\("inventory_levels"\)\.update/);
  assert.doesNotMatch(legacyActions, /from\("inventory_levels"\)\.update/);
});

test("Phase 7 store filtering keeps authorized source warehouses available for transfer requests", async () => {
  const replenishmentPage = await source("src/app/(back-office)/back-office/replenishment/page.tsx");

  assert.match(replenishmentPage, /The filter narrows recommendations and history/);
  assert.match(replenishmentPage, /const stores = storesResult\.data \?\? \[\];/);
  assert.match(replenishmentPage, /const warehouses = warehousesResult\.data \?\? \[\];/);
  assert.match(replenishmentPage, /const rules = \(rulesResult\.data \?\? \[\]\)\.filter\(\(rule\) => visibleStore\(rule\.store_id\)\)/);
  assert.match(replenishmentPage, /defaultStoreId=\{storeScope\.selectedStoreId\}/);
});
