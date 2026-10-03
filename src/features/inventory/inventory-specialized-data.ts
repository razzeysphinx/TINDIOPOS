import "server-only";

import type { TableRow } from "@/lib/supabase/database.types";

type ReadError = { code?: string; details?: string; hint?: string; message: string };
type RpcResult = { data: unknown; error: ReadError | null };
type ValuationProduct = Pick<TableRow<"products">, "id" | "name" | "unit" | "status" | "product_type" | "price_minor">;
type ValuationVariant = Pick<TableRow<"product_variants">, "id" | "product_id" | "name" | "price_minor" | "is_active">;
type ValuationStore = Pick<TableRow<"stores">, "id" | "name">;
type ActivityMovement = Pick<TableRow<"inventory_movements">, "id" | "store_id" | "product_id" | "variant_id" | "quantity_delta" | "quantity_before" | "quantity_after" | "movement_type" | "actor_employee_id" | "reason" | "reason_code" | "source_type" | "source_id" | "unit_snapshot" | "created_at">;
type ActivityEmployee = Pick<TableRow<"employees">, "id" | "profile_id" | "employee_number">;
type ActivityProfile = Pick<TableRow<"profiles">, "id" | "full_name">;
type RefundReference = Pick<TableRow<"refunds">, "id" | "sale_id">;
type ReceiptReference = Pick<TableRow<"receipts">, "id" | "sale_id" | "receipt_number">;
type AdjustmentReference = Pick<TableRow<"inventory_adjustments">, "id" | "adjustment_number">;
type CountReference = Pick<TableRow<"inventory_counts">, "id" | "count_number">;
type TransferReference = Pick<TableRow<"stock_transfers">, "id" | "transfer_number">;
type SupplierReturnReference = Pick<TableRow<"supplier_returns">, "id">;
type ProductionRunReference = Pick<TableRow<"production_runs">, "id">;

export type InventoryValuationReferenceBundle = { products: ValuationProduct[]; variants: ValuationVariant[]; stores: ValuationStore[] };
export type InventoryActivityReferenceNeed = "movements" | "employees" | "profiles" | "refunds" | "receipts" | "adjustments" | "counts" | "transfers" | "supplierReturns" | "productionRuns";
export type InventoryActivityReferenceBundle = { movements: ActivityMovement[]; employees: ActivityEmployee[]; profiles: ActivityProfile[]; refunds: RefundReference[]; receipts: ReceiptReference[]; adjustments: AdjustmentReference[]; counts: CountReference[]; transfers: TransferReference[]; supplierReturns: SupplierReturnReference[]; productionRuns: ProductionRunReference[] };

const recordOf = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = <T,>(record: Record<string, unknown>, key: string) => Array.isArray(record[key]) ? record[key] as T[] : [];
const emptyActivity = (): InventoryActivityReferenceBundle => ({ movements: [], employees: [], profiles: [], refunds: [], receipts: [], adjustments: [], counts: [], transfers: [], supplierReturns: [], productionRuns: [] });

export async function loadInventoryValuationReferenceBundleResult({ client, organizationId, enabled }: { client: unknown; organizationId: string; enabled: boolean }): Promise<{ data: InventoryValuationReferenceBundle; error: ReadError | null }> {
  if (!enabled) return { data: { products: [], variants: [], stores: [] }, error: null };
  const result = await (client as { rpc(name: "get_inventory_valuation_reference_bundle_v1", args: { target_organization_id: string }): PromiseLike<RpcResult> }).rpc("get_inventory_valuation_reference_bundle_v1", { target_organization_id: organizationId });
  const record = recordOf(result.data);
  return { data: { products: rows<ValuationProduct>(record, "products"), variants: rows<ValuationVariant>(record, "variants"), stores: rows<ValuationStore>(record, "stores") }, error: result.error };
}

export async function loadInventoryActivityReferenceBundleResult({ client, organizationId, detailStoreId, detailProductId, detailVariantId, movementIds, limit, needs }: { client: unknown; organizationId: string; detailStoreId: string | null; detailProductId: string | null; detailVariantId: string | null; movementIds: string[] | null; limit: number; needs: readonly InventoryActivityReferenceNeed[] }): Promise<{ data: InventoryActivityReferenceBundle; error: ReadError | null }> {
  if (!detailStoreId && !detailProductId && (!movementIds || movementIds.length === 0)) return { data: emptyActivity(), error: null };
  const result = await (client as { rpc(name: "get_inventory_activity_reference_bundle_v1", args: { target_organization_id: string; target_store_id: string | null; target_product_id: string | null; target_variant_id: string | null; requested_movement_ids: string[] | null; requested_limit: number; requested_needs: readonly InventoryActivityReferenceNeed[] }): PromiseLike<RpcResult> }).rpc("get_inventory_activity_reference_bundle_v1", { target_organization_id: organizationId, target_store_id: detailStoreId, target_product_id: detailProductId, target_variant_id: detailVariantId, requested_movement_ids: movementIds, requested_limit: limit, requested_needs: needs });
  const record = recordOf(result.data);
  return { data: { movements: rows<ActivityMovement>(record, "movements"), employees: rows<ActivityEmployee>(record, "employees"), profiles: rows<ActivityProfile>(record, "profiles"), refunds: rows<RefundReference>(record, "refunds"), receipts: rows<ReceiptReference>(record, "receipts"), adjustments: rows<AdjustmentReference>(record, "adjustments"), counts: rows<CountReference>(record, "counts"), transfers: rows<TransferReference>(record, "transfers"), supplierReturns: rows<SupplierReturnReference>(record, "supplierReturns"), productionRuns: rows<ProductionRunReference>(record, "productionRuns") }, error: result.error };
}
