export type InventoryWorkspaceDataNeed =
  | "stores"
  | "categories"
  | "products"
  | "variants"
  | "productUnits"
  | "productStoreSettings"
  | "inventoryLevels"
  | "valuation"
  | "movements"
  | "suppliers"
  | "purchaseOrders"
  | "purchaseOrderLines"
  | "goodsReceipts"
  | "goodsReceiptLines"
  | "inventoryPolicies"
  | "adjustmentReasons"
  | "stockTransfers"
  | "replenishmentRules"
  | "inventoryCounts"
  | "inventoryCountBatches"
  | "warehouses"
  | "countSuppliers"
  | "countAwareness"
  | "offlineInventoryIssues";

export type InventoryWorkspaceDataNeeds =
  ReadonlySet<InventoryWorkspaceDataNeed>;

type InventoryWorkspaceDataNeedsInput = {
  workspace: "control" | "purchasing";
  activeTab: string;
  canCreatePurchaseOrders: boolean;
  canReceivePurchaseOrders: boolean;
  canManageSuppliers: boolean;
  canReturnToSupplier: boolean;
  canViewPurchasing: boolean;
  canViewCosts: boolean;
};

const CONTROL_DATA_NEEDS: readonly InventoryWorkspaceDataNeed[] = [
  "stores",
  "categories",
  "products",
  "variants",
  "productUnits",
  "productStoreSettings",
  "inventoryLevels",
  "valuation",
  "movements",
  "suppliers",
  "purchaseOrders",
  "purchaseOrderLines",
  "goodsReceipts",
  "goodsReceiptLines",
  "inventoryPolicies",
  "adjustmentReasons",
  "stockTransfers",
  "replenishmentRules",
  "inventoryCounts",
  "inventoryCountBatches",
  "warehouses",
  "countSuppliers",
  "countAwareness",
  "offlineInventoryIssues",
];

/**
 * Defines the data read shape for the server-rendered Inventory workspaces.
 * Purchasing deliberately models each tab independently so it cannot inherit
 * Stock Control's health, ledger, count, transfer, or valuation fan-out.
 */
export function getInventoryWorkspaceDataNeeds(
  input: InventoryWorkspaceDataNeedsInput,
): InventoryWorkspaceDataNeeds {
  if (input.workspace === "control") {
    return new Set(CONTROL_DATA_NEEDS);
  }

  const needs = new Set<InventoryWorkspaceDataNeed>();

  switch (input.activeTab) {
    case "purchase-orders":
      needs.add("stores");
      needs.add("products");
      needs.add("variants");
      needs.add("productStoreSettings");
      needs.add("suppliers");
      needs.add("purchaseOrders");
      needs.add("purchaseOrderLines");
      if (input.canCreatePurchaseOrders) {
        needs.add("productUnits");
      }
      break;
    case "receiving":
      needs.add("stores");
      needs.add("suppliers");
      needs.add("purchaseOrders");
      needs.add("purchaseOrderLines");
      needs.add("goodsReceipts");
      needs.add("goodsReceiptLines");
      break;
    case "suppliers":
      needs.add("suppliers");
      break;
    case "supplier-returns":
      needs.add("stores");
      needs.add("products");
      needs.add("variants");
      needs.add("productStoreSettings");
      needs.add("suppliers");
      break;
    default:
      break;
  }

  return needs;
}
