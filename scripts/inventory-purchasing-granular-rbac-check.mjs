import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

const migrationPath = "supabase/migrations/20260911062913_purchasing_granular_rbac_integration.sql";

test("Phase 10 tags canonical purchasing commands with their granular capabilities", async () => {
  const migration = await source(migrationPath);

  for (const [procedure, capability] of [
    ["private.create_supplier", "purchasing.suppliers.manage"],
    ["public.update_supplier", "purchasing.suppliers.manage"],
    ["private.import_suppliers_csv", "purchasing.suppliers.manage"],
    ["private.create_purchase_order", "purchasing.po.create"],
    ["private.cancel_purchase_order", "purchasing.po.create"],
    ["private.receive_purchase_order", "purchasing.receive"],
    ["private.return_to_supplier", "purchasing.return"],
  ]) {
    assert.match(
      migration,
      new RegExp(`${procedure.replaceAll(".", "\\.")}[\\s\\S]*?tindio\\.inventory_required_capabilities to '${capability.replaceAll(".", "\\.")}'`),
    );
  }

  assert.match(migration, /notify pgrst, 'reload schema';/);
  assert.doesNotMatch(migration, /role\.code|role_name/i);
  assert.doesNotMatch(migration, /update public\.inventory_levels/);
});

test("Phase 10 purchasing read policies retain organization and store scope", async () => {
  const migration = await source(migrationPath);

  for (const policy of [
    "purchase_orders_select_purchasing_scope",
    "purchase_order_lines_select_purchasing_scope",
    "goods_receipts_select_purchasing_scope",
    "goods_receipt_lines_select_purchasing_scope",
    "supplier_returns_select_purchasing_scope",
    "supplier_return_lines_select_purchasing_scope",
  ]) {
    assert.match(migration, new RegExp(`create policy ${policy}`));
  }

  assert.match(migration, /private\.has_any_inventory_capability/);
  assert.match(migration, /private\.has_store_read_scope/);
  assert.match(migration, /private\.has_purchase_order_read_scope/);
  assert.match(migration, /from public\.goods_receipts goods_receipt/);
  assert.match(migration, /from public\.supplier_returns supplier_return/);
  assert.match(migration, /array\['purchasing\.po\.create', 'purchasing\.receive', 'purchasing\.return'\]/);
});

test("server actions require the specific purchasing capability, not a shared manager gate", async () => {
  const actions = await source("src/features/inventory/advanced-inventory-actions.ts");

  assert.match(actions, /async function requirePurchasingCapability/);
  assert.match(actions, /createSupplierAction[\s\S]*?"purchasing\.suppliers\.manage"/);
  assert.match(actions, /updateSupplierAction[\s\S]*?"purchasing\.suppliers\.manage"/);
  assert.match(actions, /importSuppliersCsvAction[\s\S]*?"purchasing\.suppliers\.manage"/);
  assert.match(actions, /createPurchaseOrderAction[\s\S]*?"purchasing\.po\.create"/);
  assert.match(actions, /cancelPurchaseOrderAction[\s\S]*?"purchasing\.po\.create"/);
  assert.match(actions, /receivePurchaseOrderAction[\s\S]*?"purchasing\.receive"/);
  assert.match(actions, /returnToSupplierAction[\s\S]*?"purchasing\.return"/);
  assert.match(actions, /createPurchaseOrderAction[\s\S]*?products\.view_cost/);
  assert.match(actions, /returnToSupplierAction[\s\S]*?revalidatePath\("\/back-office\/purchasing"\)/);
});

test("Purchasing UI uses the shared capability map to show only authorized operations", async () => {
  const [page, navigation, workflows, integrity] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
    source("src/features/inventory/inventory-integrity-workflows.tsx"),
  ]);

  assert.match(page, /"purchasing\.view"/);
  assert.match(page, /const canAccessPurchasing = hasAnyInventoryCapability/);
  assert.match(page, /const canOpenPurchasingTab/);
  assert.match(page, /canCreatePurchaseOrders=\{canCreatePurchaseOrders\}/);
  assert.match(page, /canPostSupplierReturns=\{canReturnToSupplier\}/);
  assert.match(navigation, /canViewPurchasing/);
  assert.match(navigation, /canCreatePurchaseOrders/);
  assert.match(navigation, /canReceivePurchaseOrders/);
  assert.match(workflows, /canManageSuppliers \? <SupplierCsvTools/);
  assert.match(workflows, /canCreatePurchaseOrders \? <WorkflowCard/);
  assert.match(workflows, /canReceivePurchaseOrders \? <WorkflowCard/);
  assert.match(workflows, /canUseLegacyCsvTools && canViewCosts/);
  assert.match(integrity, /canPostSupplierReturns/);
});
