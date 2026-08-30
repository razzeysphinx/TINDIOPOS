import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

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

test("Phase 6 keeps cost visibility and receiving mutations on the existing safeguards", async () => {
  const workflow = await source("src/features/inventory/advanced-inventory-workflows.tsx");

  assert.match(workflow, /canViewCosts && activeSuppliers/);
  assert.match(workflow, /Purchase-order creation requires the existing cost-view permission/);
  assert.match(workflow, /receivableOrders/);
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
