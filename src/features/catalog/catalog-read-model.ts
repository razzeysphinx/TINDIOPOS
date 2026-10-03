import "server-only";

import type { TableRow } from "@/lib/supabase/database.types";

type ReadError = { code?: string; details?: string; hint?: string; message: string };
type RpcResult = { data: unknown; error: ReadError | null };
type Category = Pick<TableRow<"categories">, "id" | "name" | "is_archived">;
type Store = Pick<TableRow<"stores">, "id" | "name" | "is_active">;
type Product = Pick<TableRow<"products">, "id" | "category_id" | "name" | "description" | "product_type" | "sku" | "barcode" | "price_minor" | "track_inventory" | "unit" | "image_url" | "is_variable_price" | "allow_fractional_quantity" | "is_composite" | "composite_inventory_mode" | "status" | "created_at">;
type Variant = Pick<TableRow<"product_variants">, "id" | "product_id" | "name" | "sku" | "barcode" | "price_minor" | "sort_order" | "is_active">;
type StoreSetting = Pick<TableRow<"product_store_settings">, "product_id" | "store_id" | "is_available" | "price_override_minor" | "low_stock_level" | "restock_policy">;
type InventoryLevel = Pick<TableRow<"inventory_levels">, "product_id" | "variant_id" | "store_id" | "quantity">;
type ReplenishmentRule = Pick<TableRow<"inventory_replenishment_rules">, "product_id" | "variant_id" | "store_id" | "reorder_point">;
type ProductUnit = Pick<TableRow<"product_units">, "id" | "product_id" | "unit_code" | "unit_name" | "factor_to_base" | "is_base" | "is_sale_unit" | "is_purchase_unit">;
type ProductComponent = Pick<TableRow<"product_components">, "id" | "product_id" | "component_product_id" | "component_variant_id" | "quantity_per_composite">;

export type CatalogReadNeed = "categories" | "stores" | "products" | "variants" | "productStoreSettings" | "inventoryLevels" | "replenishmentRules" | "productUnits" | "productComponents";
export type CatalogReadBundle = { categories: Category[]; stores: Store[]; products: Product[]; variants: Variant[]; productStoreSettings: StoreSetting[]; inventoryLevels: InventoryLevel[]; replenishmentRules: ReplenishmentRule[]; productUnits: ProductUnit[]; productComponents: ProductComponent[] };
const recordOf = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = <T,>(record: Record<string, unknown>, key: string) => Array.isArray(record[key]) ? record[key] as T[] : [];

export async function loadCatalogReadBundleResult({ client, organizationId, needs }: { client: unknown; organizationId: string; needs: readonly CatalogReadNeed[] }): Promise<{ data: CatalogReadBundle; error: ReadError | null }> {
  const result = await (client as { rpc(name: "get_catalog_workspace_bundle_v1", args: { target_organization_id: string; requested_needs: readonly CatalogReadNeed[] }): PromiseLike<RpcResult> }).rpc("get_catalog_workspace_bundle_v1", { target_organization_id: organizationId, requested_needs: needs });
  const record = recordOf(result.data);
  return { data: { categories: rows<Category>(record, "categories"), stores: rows<Store>(record, "stores"), products: rows<Product>(record, "products"), variants: rows<Variant>(record, "variants"), productStoreSettings: rows<StoreSetting>(record, "productStoreSettings"), inventoryLevels: rows<InventoryLevel>(record, "inventoryLevels"), replenishmentRules: rows<ReplenishmentRule>(record, "replenishmentRules"), productUnits: rows<ProductUnit>(record, "productUnits"), productComponents: rows<ProductComponent>(record, "productComponents") }, error: result.error };
}
