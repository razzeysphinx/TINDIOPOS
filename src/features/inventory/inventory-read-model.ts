import "server-only";

type DatabaseNumber = number | string;

export type InventoryBundleNeed =
  | "stores"
  | "categories"
  | "products"
  | "variants"
  | "productStoreSettings"
  | "inventoryLevels"
  | "suppliers"
  | "warehouses"
  | "replenishmentRules"
  | "stockRequests"
  | "stockRequestLines"
  | "stockRequestDiscrepancies"
  | "requestStockTransfers"
  | "receivableStockTransfers"
  | "stockTransferLines"
  | "openPurchaseOrders"
  | "openPurchaseOrderLines"
  | "archivedProductCount"
  | "activityProducts"
  | "activityStores"
  | "inventoryPolicies"
  | "inventoryPolicyDefaults"
  | "adjustmentReasons"
  | "offlineInventoryIssues"
  | "movements";

export type InventoryReadModelError = {
  code?: string;
  details?: string;
  hint?: string;
  message: string;
};

type Store = { id: string; name: string; is_active?: boolean };
type Category = { id: string; name: string; is_archived?: boolean };
type Product = {
  id: string;
  category_id: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  product_type: string;
  is_composite: boolean;
  composite_inventory_mode: string | null;
  unit: string;
  status: string;
  track_inventory: boolean;
  price_minor: number;
};
type Variant = { id: string; product_id: string; name: string; sku: string | null; barcode: string | null; sort_order: number; is_active: boolean; price_minor: number | null };
type ProductStoreSetting = { product_id: string; store_id: string; is_available: boolean; price_override_minor: number | null; restock_policy: string | null; updated_at: string };
type InventoryLevel = { id: string; store_id: string; product_id: string; variant_id: string | null; quantity: DatabaseNumber; updated_at: string };
type Warehouse = { id: string; store_id: string; code: string; name: string };
type ReplenishmentRule = { id: string; store_id: string; product_id: string; variant_id: string | null; preferred_warehouse_id: string | null; reorder_point: DatabaseNumber; target_stock: DatabaseNumber };
type StockRequest = { id: string; request_number: DatabaseNumber; requesting_store_id: string; source_warehouse_id: string; status: string; note: string | null; requested_at: string; approved_at: string | null; picked_at: string | null; dispatched_at: string | null; received_at: string | null; updated_at: string };
type StockRequestLine = { id: string; stock_request_id: string; product_name_snapshot: string; variant_name_snapshot: string | null; unit_snapshot: string; requested_quantity: DatabaseNumber; approved_quantity: DatabaseNumber; picked_quantity: DatabaseNumber; dispatched_quantity: DatabaseNumber; received_quantity: DatabaseNumber; short_quantity: DatabaseNumber };
type StockRequestDiscrepancy = { stock_request_id: string; stock_request_line_id: string; short_quantity: DatabaseNumber; note: string; reported_at: string };
type StockTransfer = { id: string; stock_request_id: string | null; source_store_id: string; destination_store_id: string; status: string; transfer_number: DatabaseNumber; note: string | null };
type StockTransferLine = { id: string; stock_transfer_id: string; stock_request_line_id: string | null; product_id: string; variant_id: string | null; quantity: DatabaseNumber; received_quantity: DatabaseNumber; short_quantity: DatabaseNumber };
type Supplier = { id: string; name: string; lead_time_days: number };
type OpenPurchaseOrder = { id: string; order_number: DatabaseNumber; supplier_id: string; store_id: string; status: string; expected_at: string | null };
type OpenPurchaseOrderLine = { purchase_order_id: string; product_id: string; variant_id: string | null; ordered_quantity: DatabaseNumber; received_quantity: DatabaseNumber };
type ActivityProduct = { id: string; name: string; unit: string };
type ActivityStore = { id: string; name: string };
type InventoryPolicy = { store_id: string; negative_stock_policy: string };
type InventoryPolicyDefault = { negative_stock_policy: string };
type AdjustmentReason = { code: string; name: string; movement_type: string };
type OfflineInventoryIssue = { id: string; store_id: string; store_name_snapshot: string; state: string; conflict_type: string | null; last_attempt_at?: string | null };
type InventoryMovement = { id: string; store_id: string; product_id: string; variant_id: string | null; quantity_delta: DatabaseNumber; quantity_before: DatabaseNumber; quantity_after: DatabaseNumber; movement_type: string; actor_employee_id: string | null; reason: string | null; reason_code: string | null; source_type: string | null; source_id: string | null; unit_snapshot: string; created_at: string };

export type InventoryWorkspaceBundle = {
  stores: Store[];
  categories: Category[];
  products: Product[];
  variants: Variant[];
  productStoreSettings: ProductStoreSetting[];
  inventoryLevels: InventoryLevel[];
  warehouses: Warehouse[];
  replenishmentRules: ReplenishmentRule[];
  stockRequests: StockRequest[];
  stockRequestLines: StockRequestLine[];
  stockRequestDiscrepancies: StockRequestDiscrepancy[];
  requestStockTransfers: StockTransfer[];
  receivableStockTransfers: StockTransfer[];
  stockTransferLines: StockTransferLine[];
  suppliers: Supplier[];
  openPurchaseOrders: OpenPurchaseOrder[];
  openPurchaseOrderLines: OpenPurchaseOrderLine[];
  activityProducts: ActivityProduct[];
  activityStores: ActivityStore[];
  inventoryPolicies: InventoryPolicy[];
  inventoryPolicyDefaults: InventoryPolicyDefault[];
  adjustmentReasons: AdjustmentReason[];
  offlineInventoryIssues: OfflineInventoryIssue[];
  movements: InventoryMovement[];
  archivedProductCount: number;
};

type BundleClient = {
  rpc: (
    name: "get_inventory_workspace_bundle_v1",
    args: {
      target_organization_id: string;
      target_store_ids: string[] | null;
      requested_needs: readonly InventoryBundleNeed[];
      requested_activity_from: string | null;
      requested_activity_to: string | null;
      requested_activity_movement_type: string | null;
      requested_activity_source_type: string | null;
      requested_activity_source_id: string | null;
      requested_activity_limit: number;
      requested_activity_offset: number;
    },
  ) => PromiseLike<{ data: unknown; error: InventoryReadModelError | null }>;
};

const ARRAY_KEYS = [
  "stores", "categories", "products", "variants", "productStoreSettings", "inventoryLevels", "warehouses", "replenishmentRules",
  "stockRequests", "stockRequestLines", "stockRequestDiscrepancies", "requestStockTransfers", "receivableStockTransfers", "stockTransferLines",
  "suppliers", "openPurchaseOrders", "openPurchaseOrderLines",
  "activityProducts", "activityStores", "inventoryPolicies", "inventoryPolicyDefaults", "adjustmentReasons", "offlineInventoryIssues", "movements",
] as const;

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function normalizeBundle(value: unknown): InventoryWorkspaceBundle {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const normalized = Object.fromEntries(ARRAY_KEYS.map((key) => [key, rows(record[key])])) as Omit<InventoryWorkspaceBundle, "archivedProductCount">;
  return {
    ...normalized,
    archivedProductCount: Number(record.archivedProductCount ?? 0) || 0,
  };
}

export function bundleRows<T>(bundle: InventoryWorkspaceBundle, key: keyof InventoryWorkspaceBundle): T[] {
  return rows<T>(bundle[key]);
}

export function emptyInventoryWorkspaceBundle(): InventoryWorkspaceBundle {
  return normalizeBundle({});
}

export async function loadInventoryWorkspaceBundleResult({
  client,
  organizationId,
  storeIds,
  needs,
  activityFrom = null,
  activityTo = null,
  activityMovementType = null,
  activitySourceType = null,
  activitySourceId = null,
  activityLimit = 30,
  activityOffset = 0,
}: {
  client: unknown;
  organizationId: string;
  storeIds: string[] | null;
  needs: readonly InventoryBundleNeed[];
  activityFrom?: string | null;
  activityTo?: string | null;
  activityMovementType?: string | null;
  activitySourceType?: string | null;
  activitySourceId?: string | null;
  activityLimit?: number;
  activityOffset?: number;
}): Promise<{ data: InventoryWorkspaceBundle; error: InventoryReadModelError | null }> {
  const result = await (client as BundleClient).rpc("get_inventory_workspace_bundle_v1", {
    target_organization_id: organizationId,
    target_store_ids: storeIds,
    requested_needs: needs,
    requested_activity_from: activityFrom,
    requested_activity_to: activityTo,
    requested_activity_movement_type: activityMovementType,
    requested_activity_source_type: activitySourceType,
    requested_activity_source_id: activitySourceId,
    requested_activity_limit: activityLimit,
    requested_activity_offset: activityOffset,
  });

  return { data: normalizeBundle(result.data), error: result.error };
}
