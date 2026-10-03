import "server-only";

import {
  emptyInventoryWorkspaceBundle,
  loadInventoryWorkspaceBundleResult,
  type InventoryBundleNeed,
} from "@/features/inventory/inventory-read-model";

type BundleResult = Awaited<ReturnType<typeof loadInventoryWorkspaceBundleResult>>;

function emptyResult(): BundleResult {
  return { data: emptyInventoryWorkspaceBundle(), error: null };
}

export async function loadInventoryControlCoreData({
  client, organizationId, storeIds, activeTab, canReadOperationalStock, canManage, canAdjust, canAccessTransfers,
  canManageDevices, replenishmentEnabled, directTransfersEnabled, showConfiguration, activityFrom, activityTo,
  activityMovementType, activitySourceType, activitySourceId, activityLimit, activityOffset,
}: {
  client: unknown; organizationId: string; storeIds: string[] | null; activeTab: string;
  canReadOperationalStock: boolean; canManage: boolean; canAdjust: boolean; canAccessTransfers: boolean; canManageDevices: boolean;
  replenishmentEnabled: boolean; directTransfersEnabled: boolean; showConfiguration: boolean;
  activityFrom: string | null; activityTo: string | null; activityMovementType: string | null; activitySourceType: string | null;
  activitySourceId: string | null; activityLimit: number; activityOffset: number;
}) {
  const coreNeeds: InventoryBundleNeed[] = ["stores", "categories", "products", "variants"];
  if (canReadOperationalStock) coreNeeds.push("productStoreSettings", "inventoryLevels");
  if (activeTab === "activity") coreNeeds.push("activityProducts", "activityStores");
  if (activeTab === "overview" || activeTab === "activity") coreNeeds.push("movements");
  if (canManageDevices && activeTab === "overview") coreNeeds.push("offlineInventoryIssues");

  const operationsNeeds: InventoryBundleNeed[] = [];
  if (canManage) operationsNeeds.push("inventoryPolicies", "inventoryPolicyDefaults");
  if (canAdjust) operationsNeeds.push("adjustmentReasons");
  if (canManage && replenishmentEnabled) operationsNeeds.push("replenishmentRules");
  if (canManage && showConfiguration) operationsNeeds.push("warehouses");

  const transferNeeds: InventoryBundleNeed[] = canAccessTransfers && directTransfersEnabled
    ? ["receivableStockTransfers", "stockTransferLines"] : [];

  const [core, operations, transfers] = await Promise.all([
    loadInventoryWorkspaceBundleResult({ client, organizationId, storeIds, needs: coreNeeds, activityFrom, activityTo, activityMovementType, activitySourceType, activitySourceId, activityLimit, activityOffset }),
    operationsNeeds.length ? loadInventoryWorkspaceBundleResult({ client, organizationId, storeIds, needs: operationsNeeds }) : Promise.resolve(emptyResult()),
    transferNeeds.length ? loadInventoryWorkspaceBundleResult({ client, organizationId, storeIds, needs: transferNeeds }) : Promise.resolve(emptyResult()),
  ]);

  return { core, operations, transfers };
}
