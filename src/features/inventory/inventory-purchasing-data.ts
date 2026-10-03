import "server-only";

import type { TableRow } from "@/lib/supabase/database.types";

export type InventoryPurchasingBundleNeed =
  | "stores" | "products" | "variants" | "productUnits" | "productStoreSettings"
  | "suppliers" | "purchaseOrders" | "purchaseOrderLines" | "goodsReceipts"
  | "goodsReceiptLines" | "openPurchaseOrdersCount";

export type InventoryPurchasingReadError = { code?: string; details?: string; hint?: string; message: string };
type Store = Pick<TableRow<"stores">, "id" | "name" | "is_active">;
type Product = Pick<TableRow<"products">, "id" | "name" | "sku" | "barcode" | "product_type" | "unit" | "status" | "track_inventory">;
type Variant = Pick<TableRow<"product_variants">, "id" | "product_id" | "name" | "sku" | "barcode" | "sort_order" | "is_active">;
type ProductUnit = Pick<TableRow<"product_units">, "product_id" | "unit_code" | "unit_name" | "factor_to_base" | "is_base" | "is_purchase_unit">;
type ProductStoreSetting = Pick<TableRow<"product_store_settings">, "product_id" | "store_id" | "is_available">;
type Supplier = Pick<TableRow<"suppliers">, "id" | "name" | "contact_name" | "email" | "phone" | "address" | "notes" | "is_active" | "lead_time_days">;
type PurchaseOrder = Pick<TableRow<"purchase_orders">, "id" | "supplier_id" | "store_id" | "order_number" | "status" | "expected_at" | "created_at">;
type PurchaseOrderLine = Pick<TableRow<"purchase_order_lines">, "id" | "purchase_order_id" | "product_id" | "variant_id" | "product_name_snapshot" | "variant_name_snapshot" | "unit_snapshot" | "purchase_unit_code_snapshot" | "purchase_unit_factor_to_base" | "ordered_quantity" | "received_quantity">;
type GoodsReceipt = Pick<TableRow<"goods_receipts">, "id" | "receipt_number" | "purchase_order_id" | "store_id" | "note" | "received_at">;
type GoodsReceiptLine = Pick<TableRow<"goods_receipt_lines">, "goods_receipt_id" | "purchase_order_line_id" | "quantity_received">;

export type InventoryPurchasingBundle = {
  stores: Store[]; products: Product[]; variants: Variant[]; productUnits: ProductUnit[];
  productStoreSettings: ProductStoreSetting[]; suppliers: Supplier[]; purchaseOrders: PurchaseOrder[];
  purchaseOrderLines: PurchaseOrderLine[]; goodsReceipts: GoodsReceipt[]; goodsReceiptLines: GoodsReceiptLine[];
  openPurchaseOrdersCount: number;
};
type BundleClient = { rpc(name: "get_inventory_purchasing_bundle_v1", args: { target_organization_id: string; target_store_ids: string[] | null; requested_needs: readonly InventoryPurchasingBundleNeed[] }): PromiseLike<{ data: unknown; error: InventoryPurchasingReadError | null }> };
const ARRAY_KEYS = ["stores", "products", "variants", "productUnits", "productStoreSettings", "suppliers", "purchaseOrders", "purchaseOrderLines", "goodsReceipts", "goodsReceiptLines"] as const;
const rows = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];
function normalizeBundle(value: unknown): InventoryPurchasingBundle {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return { ...Object.fromEntries(ARRAY_KEYS.map((key) => [key, rows(record[key])])) as Omit<InventoryPurchasingBundle, "openPurchaseOrdersCount">, openPurchaseOrdersCount: Number(record.openPurchaseOrdersCount ?? 0) || 0 };
}
export function emptyInventoryPurchasingBundle(): InventoryPurchasingBundle { return normalizeBundle({}); }
export async function loadInventoryPurchasingBundleResult({ client, organizationId, storeIds, needs }: { client: unknown; organizationId: string; storeIds: string[] | null; needs: readonly InventoryPurchasingBundleNeed[] }): Promise<{ data: InventoryPurchasingBundle; error: InventoryPurchasingReadError | null }> {
  if (!needs.length) return { data: emptyInventoryPurchasingBundle(), error: null };
  const result = await (client as BundleClient).rpc("get_inventory_purchasing_bundle_v1", { target_organization_id: organizationId, target_store_ids: storeIds, requested_needs: needs });
  return { data: normalizeBundle(result.data), error: result.error };
}
