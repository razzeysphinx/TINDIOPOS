import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 1 merges health and restock navigation without changing transfer workflows", async () => {
  const [inventoryPage, replenishmentPage, navigation] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/app/(back-office)/back-office/replenishment/page.tsx"),
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
  ]);

  assert.match(navigation, /\{ id: "replenishment", label: "Replenishment" \}/);
  assert.doesNotMatch(navigation, /\{ id: "health", label:/);
  assert.doesNotMatch(navigation, /\{ id: "needs-restocking", label:/);
  assert.doesNotMatch(navigation, /\{ id: "requests", label:/);
  assert.match(inventoryPage, /candidate === "health"\) return "overview"/);
  assert.match(inventoryPage, /<div id="stock-health-details">/);
  assert.match(replenishmentPage, /candidate === "needs-restocking" \|\| candidate === "requests"/);
  assert.match(replenishmentPage, /activeTab === "replenishment"/);
  assert.match(replenishmentPage, /sections=\{\["needs-restocking", "requests"\]\}/);
});

test("Phase 5 provides a direct transfer workspace without replacing replenishment requests", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");
  const workspace = await source("src/features/inventory/inventory-transfer-workspace.tsx");

  assert.match(inventoryPage, /InventoryTransferWorkspace/);
  assert.match(inventoryPage, /awaitingReceiptCount=\{directInTransitTransfers\.length\}/);
  assert.match(inventoryPage, /items=\{directTransferItems\}/);
  assert.doesNotMatch(inventoryPage, /sections=\{\["transfers"\]\}/);
  assert.match(workspace, /Direct store transfer/);
  assert.match(workspace, /Source on hand/);
  assert.match(workspace, /Safe excess/);
  assert.match(workspace, /Destination on hand/);
  assert.match(workspace, /Send transfer/);
});

test("Phase 7 keeps replenishment suggestions source-aware and non-automatic", async () => {
  const workflow = await source("src/features/inventory/supply-chain-workflows.tsx");

  assert.match(workflow, /function ReplenishmentRecommendations/);
  assert.match(workflow, /Suggested transfer:/);
  assert.match(workflow, /Prepare transfer request/);
  assert.match(workflow, /Plan supplier purchase/);
  assert.match(workflow, /never create a transfer or purchase order automatically/);
  assert.match(workflow, /source\.safeExcessQuantity > 0/);
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

test("direct transfer actions use the canonical transfer RPCs without client ledger writes", async () => {
  const actions = await source("src/features/inventory/supply-chain-actions.ts");
  const legacyActions = await source("src/features/inventory/advanced-inventory-actions.ts");

  assert.match(actions, /requireSupplyChainManager\(\)/);
  assert.match(actions, /rpc\("create_stock_request"/);
  assert.match(actions, /rpc\("approve_stock_request"/);
  assert.match(actions, /rpc\("start_stock_request_picking"/);
  assert.match(actions, /rpc\("dispatch_stock_request"/);
  assert.match(actions, /rpc\("receive_stock_request"/);
  assert.match(legacyActions, /rpc\("create_direct_stock_transfer"/);
  assert.match(legacyActions, /rpc\("receive_stock_transfer"/);
  assert.doesNotMatch(actions, /from\("inventory_levels"\)\.update/);
  assert.doesNotMatch(legacyActions, /from\("inventory_levels"\)\.update/);
});

test("direct transfers are retry-safe while request receipts remain canonical", async () => {
  const supplyChainActions = await source("src/features/inventory/supply-chain-actions.ts");
  const supplyChainWorkflows = await source("src/features/inventory/supply-chain-workflows.tsx");
  const legacyActions = await source("src/features/inventory/advanced-inventory-actions.ts");
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");
  const migration = await source("supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql");
  const directTransferMigration = await source("supabase/migrations/20260910140907_direct_store_transfer_lifecycle.sql");
  const legacyGuardMigration = await source("supabase/migrations/20260906081000_inventory_count_snapshots_and_legacy_command_guard.sql");

  assert.match(supplyChainActions, /target_operation_id: parsed\.data\.operationId/);
  assert.match(supplyChainWorkflows, /pendingOperationId\(operationScope, payload\)/);
  assert.match(supplyChainWorkflows, /transfer TR-\$\{String\(request\.transferNumber\)\.padStart\(6, "0"\)\}/);
  assert.match(legacyActions, /create_direct_stock_transfer/);
  assert.match(inventoryPage, /directInTransitTransfers/);
  assert.match(migration, /stock_requests_organization_operation_unique/);
  assert.match(migration, /stock_transfers_organization_number_unique/);
  assert.match(migration, /Receive replenishment transfers from the stock request workflow/);
  assert.match(directTransferMigration, /private\.inventory_actor\(target_organization_id, target_source_store_id\)/);
  assert.match(directTransferMigration, /private\.inventory_actor\(target_organization_id, target_destination_store_id\)/);
  assert.match(directTransferMigration, /Source stock is insufficient for this transfer/);
  assert.match(directTransferMigration, /TRANSFER_OUT/);
  assert.match(directTransferMigration, /received_quantity = received_quantity \+ received_now/);
  assert.match(directTransferMigration, /short_quantity = short_quantity \+ short_now/);
  assert.match(directTransferMigration, /Received and short quantities cannot exceed the remaining sent quantity/);
  assert.match(migration, /revoke execute on function public\.ship_stock_transfer[\s\S]*from authenticated/);
  assert.match(legacyGuardMigration, /revoke execute on function public\.transfer_stock[\s\S]*from authenticated/);
});

test("store filtering keeps authorized source warehouses available for transfer requests", async () => {
  const replenishmentPage = await source("src/app/(back-office)/back-office/replenishment/page.tsx");

  assert.match(replenishmentPage, /const authorizedStore = \(storeId: string\) => storeScope\.storeIds === null \|\| storeScope\.storeIds\.includes\(storeId\);/);
  assert.match(replenishmentPage, /const authorizedStores = \(storesResult\.data \?\? \[\]\)\.filter\(\(store\) => authorizedStore\(store\.id\)\);/);
  assert.match(replenishmentPage, /const stores = authorizedStores\.filter\(\(store\) => visibleStore\(store\.id\)\);/);
  assert.match(replenishmentPage, /const warehouses = \(warehousesResult\.data \?\? \[\]\)\.filter\(\(warehouse\) => authorizedStore\(warehouse\.store_id\)\);/);
  assert.match(replenishmentPage, /const rules = authorizedRules\.filter\(\(rule\) => visibleStore\(rule\.store_id\)\);/);
  assert.match(replenishmentPage, /defaultStoreId=\{storeScope\.selectedStoreId\}/);
});

test("Phase 4 recommends transfers only from source safe excess and preserves manual choices", async () => {
  const [replenishmentPage, workflow] = await Promise.all([
    source("src/app/(back-office)/back-office/replenishment/page.tsx"),
    source("src/features/inventory/supply-chain-workflows.tsx"),
  ]);

  assert.match(replenishmentPage, /const sourceTargetStock = targetStockByPosition\.get/);
  assert.match(replenishmentPage, /safeExcessQuantity: sourceTargetStock === null \? null : Math\.max\(0, onHandQuantity - sourceTargetStock\)/);
  assert.match(workflow, /source\.warehouseId !== null && source\.safeExcessQuantity !== null && source\.safeExcessQuantity > 0/);
  assert.match(workflow, /Source on hand .* source target .* safe excess/s);
  assert.match(workflow, /target stock is not configured\. Review the source before deciding to transfer/);
  assert.match(workflow, /is marked Do not restock/);
  assert.match(workflow, /Suggestions never create inventory documents on their own/);
  assert.match(workflow, /onPrepareTransfer\(rule, safeTransferSource\)/);
});
