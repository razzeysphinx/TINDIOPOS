import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadDataNeedsContract() {
  const source = await readFile(
    path.join(repositoryRoot, "src/features/inventory/inventory-workspace-data-needs.ts"),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const compiledModule = { exports: {} };
  new Function("exports", "module", output)(compiledModule.exports, compiledModule);
  return compiledModule.exports;
}

const inputFor = (activeTab, overrides = {}) => ({
  workspace: "purchasing",
  activeTab,
  canCreatePurchaseOrders: true,
  canReceivePurchaseOrders: true,
  canManageSuppliers: true,
  canReturnToSupplier: true,
  canViewPurchasing: true,
  canViewCosts: true,
  ...overrides,
});

const prohibitedControlReads = [
  "valuation",
  "movements",
  "inventoryPolicies",
  "adjustmentReasons",
  "stockTransfers",
  "replenishmentRules",
  "inventoryCounts",
  "inventoryCountBatches",
  "offlineInventoryIssues",
];

test("Purchase orders load their creation and history read shape without control datasets", async () => {
  const { getInventoryWorkspaceDataNeeds } = await loadDataNeedsContract();
  const needs = getInventoryWorkspaceDataNeeds(inputFor("purchase-orders"));

  for (const required of ["stores", "products", "variants", "productStoreSettings", "productUnits", "suppliers", "purchaseOrders", "purchaseOrderLines"]) {
    assert.equal(needs.has(required), true, `missing ${required}`);
  }
  for (const prohibited of prohibitedControlReads) assert.equal(needs.has(prohibited), false, `unexpected ${prohibited}`);
});

test("Receiving avoids the active catalog and all control-only data", async () => {
  const { getInventoryWorkspaceDataNeeds } = await loadDataNeedsContract();
  const needs = getInventoryWorkspaceDataNeeds(inputFor("receiving"));

  for (const required of ["stores", "suppliers", "purchaseOrders", "purchaseOrderLines", "goodsReceipts", "goodsReceiptLines"]) {
    assert.equal(needs.has(required), true, `missing ${required}`);
  }
  for (const prohibited of ["products", "variants", "productStoreSettings", "productUnits", ...prohibitedControlReads]) {
    assert.equal(needs.has(prohibited), false, `unexpected ${prohibited}`);
  }
});

test("Suppliers load supplier data only", async () => {
  const { getInventoryWorkspaceDataNeeds } = await loadDataNeedsContract();
  const needs = getInventoryWorkspaceDataNeeds(inputFor("suppliers"));

  assert.deepEqual([...needs], ["suppliers"]);
});

test("Supplier returns avoid valuation, counts, transfers, and replenishment", async () => {
  const { getInventoryWorkspaceDataNeeds } = await loadDataNeedsContract();
  const needs = getInventoryWorkspaceDataNeeds(inputFor("supplier-returns"));

  for (const required of ["stores", "products", "variants", "productStoreSettings", "suppliers"]) {
    assert.equal(needs.has(required), true, `missing ${required}`);
  }
  for (const prohibited of prohibitedControlReads) assert.equal(needs.has(prohibited), false, `unexpected ${prohibited}`);
});

test("Purchasing has an early render path before Stock Control query and mapping work", async () => {
  const page = await readFile(
    path.join(repositoryRoot, "src/app/(back-office)/back-office/inventory/page.tsx"),
    "utf8",
  );

  assert.match(page, /getInventoryWorkspaceDataNeeds\(/);
  assert.match(page, /if \(workspace === "purchasing"\) \{\s*return renderPurchasingWorkspace\(/);
  const purchasingPath = page.match(/async function renderPurchasingWorkspace\([\s\S]*?\n}\n\nexport default async function InventoryPage/)?.[0] ?? "";
  assert.ok(purchasingPath, "Purchasing early render path was not found");
  for (const table of ["inventory_levels", "inventory_movements", "inventory_replenishment_rules", "inventory_policies", "inventory_policy_defaults", "inventory_adjustment_reasons", "stock_transfers", "inventory_counts", "offline_sync_events"]) {
    assert.doesNotMatch(purchasingPath, new RegExp(`\\.from\\("${table}"\\)`));
  }
  assert.doesNotMatch(purchasingPath, /get_inventory_valuation/);
});
