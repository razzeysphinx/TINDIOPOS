import "server-only";

import type { InventoryStockFilters } from "@/features/inventory/inventory-stock-view";
import {
  loadInventoryWorkspaceBundleResult,
  type InventoryBundleNeed,
} from "@/features/inventory/inventory-read-model";
import { createClient } from "@/lib/supabase/server";

export async function loadReplenishmentWorkspaceData({
  activeTab,
  organizationId,
  storeIds,
  stockFilters,
  stockPage,
  stockPageSize,
}: {
  activeTab: "levels" | "replenishment";
  organizationId: string;
  storeIds: string[] | null;
  stockFilters: InventoryStockFilters;
  stockPage: number;
  stockPageSize: number;
}) {
  const supabase = await createClient();
  const needs: InventoryBundleNeed[] = activeTab === "levels"
    ? ["stores", "categories", "archivedProductCount"]
    : [
        "stores",
        "products",
        "variants",
        "productStoreSettings",
        "inventoryLevels",
        "warehouses",
        "replenishmentRules",
        "stockRequests",
        "stockRequestLines",
        "stockRequestDiscrepancies",
        "requestStockTransfers",
        "receivableStockTransfers",
        "stockTransferLines",
        "suppliers",
        "openPurchaseOrders",
        "openPurchaseOrderLines",
      ];

  const [bundleResult, stockPageResult] = await Promise.all([
    loadInventoryWorkspaceBundleResult({
      client: supabase,
      organizationId,
      storeIds,
      needs,
    }),
    activeTab === "levels"
      ? supabase.rpc("get_inventory_stock_page", {
          requested_category_id: stockFilters.categoryId ?? undefined,
          requested_page: stockPage,
          requested_page_size: stockPageSize,
          requested_restock_policy: stockFilters.restockPolicy,
          requested_search: stockFilters.search || undefined,
          requested_sort: stockFilters.sort,
          requested_status: stockFilters.status,
          requested_store_id: stockFilters.selectedStoreId ?? undefined,
          target_organization_id: organizationId,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (bundleResult.error) {
    throw new Error(`Unable to load replenishment bundle: ${bundleResult.error.message}`);
  }
  if (stockPageResult.error) {
    throw new Error(`Unable to load stock levels: ${stockPageResult.error.message}`);
  }

  return {
    bundle: bundleResult.data,
    stockPageEntries: stockPageResult.data ?? [],
  };
}
