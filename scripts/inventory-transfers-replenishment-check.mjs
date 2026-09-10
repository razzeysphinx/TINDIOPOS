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
  assert.match(workflow, /Suggested internal source/);
  assert.match(workflow, /Prepare transfer request/);
  assert.match(workflow, /Plan supplier purchase/);
  assert.match(workflow, /never create a transfer or purchase order automatically/);
  assert.match(workflow, /if \(!rule\.recommendedWarehouseId\) return/);
});

test("Phase 7 calculates the restock gap from on-hand and confirmed inbound quantities", async () => {
  const replenishmentPage = await source("src/app/(back-office)/back-office/replenishment/page.tsx");
  const workflow = await source("src/features/inventory/supply-chain-workflows.tsx");

  assert.match(replenishmentPage, /purchase_order_id, product_id, variant_id, ordered_quantity, received_quantity/);
  assert.match(replenishmentPage, /incomingPurchaseBySaleable/);
  assert.match(replenishmentPage, /incomingPurchaseQuantity:/);
  assert.match(replenishmentPage, /inTransitQuantity:/);
  assert.match(workflow, /const projectedQuantity = rule\.currentQuantity \+ rule\.incomingPurchaseQuantity \+ rule\.inTransitQuantity/);
  assert.match(workflow, /const suggestedQuantity = Math\.max\(0, rule\.targetStock - projectedQuantity\)/);
  assert.match(workflow, /Confirmed incoming stock already covers the target/);
  assert.match(workflow, /never create a transfer or purchase order automatically/);
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

test("Phase 3 makes transfer commands retry-safe and keeps request receipts canonical", async () => {
  const supplyChainActions = await source("src/features/inventory/supply-chain-actions.ts");
  const supplyChainWorkflows = await source("src/features/inventory/supply-chain-workflows.tsx");
  const legacyActions = await source("src/features/inventory/advanced-inventory-actions.ts");
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");
  const migration = await source("supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql");
  const legacyGuardMigration = await source("supabase/migrations/20260906081000_inventory_count_snapshots_and_legacy_command_guard.sql");

  assert.match(supplyChainActions, /target_operation_id: parsed\.data\.operationId/);
  assert.match(supplyChainWorkflows, /pendingOperationId\(operationScope, payload\)/);
  assert.match(supplyChainWorkflows, /transfer TR-\$\{String\(request\.transferNumber\)\.padStart\(6, "0"\)\}/);
  assert.match(legacyActions, /Create a stock request from Restock items/);
  assert.match(inventoryPage, /legacyInTransitTransfers/);
  assert.match(migration, /stock_requests_organization_operation_unique/);
  assert.match(migration, /stock_transfers_organization_number_unique/);
  assert.match(migration, /Receive replenishment transfers from the stock request workflow/);
  assert.match(migration, /revoke execute on function public\.ship_stock_transfer[\s\S]*from authenticated/);
  assert.match(legacyGuardMigration, /revoke execute on function public\.transfer_stock[\s\S]*from authenticated/);
});

test("Phase 7 store filtering keeps authorized source warehouses available for transfer requests", async () => {
  const replenishmentPage = await source("src/app/(back-office)/back-office/replenishment/page.tsx");

  assert.match(replenishmentPage, /The filter narrows recommendations and history/);
  assert.match(replenishmentPage, /const stores = storesResult\.data \?\? \[\];/);
  assert.match(replenishmentPage, /const warehouses = warehousesResult\.data \?\? \[\];/);
  assert.match(replenishmentPage, /const rules = \(rulesResult\.data \?\? \[\]\)\.filter\(\(rule\) => visibleStore\(rule\.store_id\)\)/);
  assert.match(replenishmentPage, /defaultStoreId=\{storeScope\.selectedStoreId\}/);
});
