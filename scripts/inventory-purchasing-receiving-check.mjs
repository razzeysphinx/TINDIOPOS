import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

const [phaseTwoMigration, phaseTwoDatabaseTest] = await Promise.all([
  source("supabase/migrations/20260906070329_purchase_order_receiving_operation_integrity.sql"),
  source("supabase/tests/database/inventory_purchase_order_receiving_integrity.test.sql"),
]);

test("Phase 2 gives purchase orders and goods receipts durable operation identity", () => {
  assert.match(phaseTwoMigration, /purchase_orders_organization_operation_unique/);
  assert.match(phaseTwoMigration, /goods_receipts_organization_operation_unique/);
  assert.match(phaseTwoMigration, /receipt_number bigint/);
  assert.match(phaseTwoMigration, /target_operation_id uuid/);
  assert.match(phaseTwoMigration, /This operation ID is already assigned to a different goods receipt request/);
  assert.match(phaseTwoMigration, /drop function if exists public\.receive_purchase_order\(uuid, uuid, jsonb, text\)/);
});

test("Phase 2 keeps purchase-unit conversion and receiving on the canonical ledger", () => {
  assert.match(phaseTwoMigration, /purchase_unit_factor_to_base numeric\(14,3\)/);
  assert.match(phaseTwoMigration, /product_unit\.is_purchase_unit or product_unit\.is_base/);
  assert.match(phaseTwoMigration, /base_quantity_received := quantity_received \* po_line\.purchase_unit_factor_to_base/);
  assert.match(phaseTwoMigration, /private\.apply_inventory_change_v2/);
  assert.match(phaseTwoMigration, /Every order item must be an active tracked item available in the receiving store/);
  assert.match(phaseTwoMigration, /public\.cancel_purchase_order/);
});

test("Phase 2 database coverage verifies no stock on ordering, retries, partial/full receiving, cancellation, scope, and authorization", () => {
  assert.match(phaseTwoDatabaseTest, /Creating a purchase order changed on-hand inventory/);
  assert.match(phaseTwoDatabaseTest, /Partial receiving or its idempotent replay is incorrect/);
  assert.match(phaseTwoDatabaseTest, /Full receiving did not post exactly two canonical receipt movements/);
  assert.match(phaseTwoDatabaseTest, /Cancelling a purchase order changed stock/);
  assert.match(phaseTwoDatabaseTest, /Receiving-store product availability was not enforced/);
  assert.match(phaseTwoDatabaseTest, /Unauthenticated purchase-order creation was not denied/);
  assert.match(phaseTwoDatabaseTest, /ROLLBACK_PHASE_2_PURCHASING_TEST/);
});

test("Phase 6 organizes the existing purchasing actions into orders, receiving, and suppliers", async () => {
  const workflow = await source("src/features/inventory/advanced-inventory-workflows.tsx");

  assert.match(workflow, /function PurchasingSectionTabs/);
  assert.match(workflow, /Purchase orders/);
  assert.match(workflow, /Receiving/);
  assert.match(workflow, /Suppliers/);
  assert.match(workflow, /function PurchaseOrdersCard/);
  assert.match(workflow, /function RecentReceiptsCard/);
  assert.match(workflow, /createPurchaseOrderAction\(/);
  assert.match(workflow, /receivePurchaseOrderAction\(/);
  assert.match(workflow, /setPurchasingSection\("receiving"\)/);
});

test("Purchasing has its own workspace while reusing the canonical workflows", async () => {
  const [navigation, page, purchasingPage, workflow] = await Promise.all([
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/app/(back-office)/back-office/purchasing/page.tsx"),
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
  ]);

  assert.match(navigation, /type InventoryWorkspace = "control" \| "restock" \| "purchasing"/);
  assert.match(navigation, /const inventoryControlItems/);
  assert.match(navigation, /const purchasingItems/);
  assert.match(navigation, /supplier-returns/);
  assert.match(navigation, /visiblePurchasingItems/);
  assert.match(navigation, /return `\/back-office\/purchasing\?\$\{query\.toString\(\)\}`/);
  assert.doesNotMatch(navigation.split("const purchasingItems")[0], /id: "receiving"/);
  assert.match(page, /workspace === "control" && legacyPurchasingTab/);
  assert.match(page, /redirect\(`\/back-office\/purchasing\?\$\{query\.toString\(\)\}`\)/);
  assert.match(page, /const purchasingTabHref/);
  assert.match(page, /workspace=\{workspace\}/);
  assert.match(purchasingPage, /<InventoryWorkspacePage \{\.\.\.props\} workspace="purchasing" \/>/);
  assert.match(page, /showPurchasingTabs=\{false\}/);
  assert.match(page, /activeTab === "supplier-returns"/);
  assert.match(page, /initialReceiptOrderId=\{requestedPurchaseOrderId\}/);
  assert.match(page, /receivingHref=\{purchasingTabHref\("receiving"\)\}/);
  assert.match(workflow, /router\.push\(`\$\{receivingHref\}&purchaseOrder=/);
  assert.match(workflow, /only receiving changes stock/);
});

test("Phase 6 keeps cost visibility and receiving mutations on the existing safeguards", async () => {
  const workflow = await source("src/features/inventory/advanced-inventory-workflows.tsx");

  assert.match(workflow, /canViewCosts && activeSuppliers/);
  assert.match(workflow, /Purchase-order creation requires the existing cost-view permission/);
  assert.match(workflow, /receivableOrders/);
  assert.match(workflow, /receivePurchaseOrderAction\(/);
  assert.doesNotMatch(workflow, /from\("inventory_levels"\)\.update/);
});

test("Phase 6 bounds purchase and receipt history reads and reuses shared inventory data", async () => {
  const page = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(page, /from\("purchase_orders"\)/);
  assert.match(page, /\.limit\(30\)/);
  assert.match(page, /from\("purchase_order_lines"\)/);
  assert.match(page, /\.in\("purchase_order_id", purchaseOrderIds\)/);
  assert.match(page, /from\("goods_receipts"\)/);
  assert.match(page, /\.limit\(50\)/);
  assert.match(page, /from\("goods_receipt_lines"\)/);
  assert.match(page, /purchaseOrders=\{purchaseOrderHistory\}/);
  assert.match(page, /receipts=\{recentGoodsReceipts\}/);
  assert.match(page, /canViewCosts=\{canViewCosts\}/);
});

test("Phase 6 scopes goods-receipt history with existing store authority and no grants", async () => {
  const migration = await source("supabase/migrations/20260829124244_goods_receipt_store_scope.sql");

  assert.match(migration, /goods_receipts_select_authorized_scope/);
  assert.match(migration, /goods_receipt_lines_select_authorized_scope/);
  assert.match(migration, /private\.has_store_read_scope\(organization_id, store_id\)/);
  assert.match(migration, /from public\.goods_receipts goods_receipt/);
  assert.doesNotMatch(migration, /grant\s+(select|all|execute)/i);
});
