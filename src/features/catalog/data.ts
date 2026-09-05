import "server-only";

import type {
  CatalogCostEntry,
  CatalogExportData,
  CatalogWorkspace,
} from "@/features/catalog/catalog-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

async function loadCatalogCostEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organizationId: string,
  productIds: string[],
): Promise<{ ok: true; costs: CatalogCostEntry[] } | { ok: false; errorMessage: string }> {
  const costsResult = await supabase.rpc("get_catalog_costs", {
    target_organization_id: organizationId,
    requested_product_ids: productIds,
  });

  if (costsResult.error) {
    return { ok: false, errorMessage: costsResult.error.message };
  }

  return { ok: true, costs: costsResult.data ?? [] };
}

export async function loadCatalogWorkspace(
  context: BusinessContext,
  options: { includeCosts?: boolean } = {},
): Promise<CatalogWorkspace> {
  const supabase = await createClient();
  const organizationId = context.organization.id;

  const [categoriesResult, storesResult, productsResult, variantsResult, settingsResult, inventoryLevelsResult, unitsResult, componentsResult] =
    await Promise.all([
      supabase
        .from("categories")
        .select("id, name, is_archived")
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("stores")
        .select("id, name, is_active")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      supabase
        .from("products")
        .select(
          "id, category_id, name, description, product_type, sku, barcode, price_minor, track_inventory, unit, image_url, is_variable_price, allow_fractional_quantity, is_composite, status, created_at",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false }),
      supabase
        .from("product_variants")
        .select(
          "id, product_id, name, sku, barcode, price_minor, sort_order, is_active",
        )
        .eq("organization_id", organizationId)
        .order("sort_order", { ascending: true }),
      supabase
        .from("product_store_settings")
        .select("product_id, store_id, is_available, price_override_minor, low_stock_level, restock_policy")
        .eq("organization_id", organizationId),
      supabase
        .from("inventory_levels")
        .select("product_id, variant_id, store_id, quantity")
        .eq("organization_id", organizationId),
      supabase
        .from("product_units")
        .select("id, product_id, unit_code, unit_name, factor_to_base, is_base, is_sale_unit, is_purchase_unit")
        .eq("organization_id", organizationId)
        .order("is_base", { ascending: false })
        .order("unit_name", { ascending: true }),
      supabase
        .from("product_components")
        .select("id, product_id, component_product_id, component_variant_id, quantity_per_composite")
        .eq("organization_id", organizationId),
    ]);

  const baseError = [
    categoriesResult,
    storesResult,
    productsResult,
    variantsResult,
    settingsResult,
    inventoryLevelsResult,
    unitsResult,
    componentsResult,
  ].find((result) => result.error)?.error;

  if (baseError) {
    throw new Error(`Unable to load the catalog: ${baseError.message}`);
  }

  const products = productsResult.data ?? [];
  let costs: CatalogCostEntry[] = [];

  if (options.includeCosts && products.length > 0) {
    const costEntries = await loadCatalogCostEntries(
      supabase,
      organizationId,
      products.map((product) => product.id),
    );
    if (!costEntries.ok) {
      throw new Error(`Unable to load product costs: ${costEntries.errorMessage}`);
    }
    costs = costEntries.costs;
  }

  return {
    categories: categoriesResult.data ?? [],
    stores: storesResult.data ?? [],
    products,
    variants: variantsResult.data ?? [],
    settings: settingsResult.data ?? [],
    costs,
    inventoryLevels: inventoryLevelsResult.data ?? [],
    units: unitsResult.data ?? [],
    components: componentsResult.data ?? [],
  };
}

export async function loadCatalogExportData(
  context: BusinessContext,
  includeCosts: boolean,
): Promise<CatalogExportData> {
  const supabase = await createClient();
  const organizationId = context.organization.id;

  const [categoriesResult, productsResult] = await Promise.all([
    supabase
      .from("categories")
      .select("id, name")
      .eq("organization_id", organizationId),
    supabase
      .from("products")
      .select(
        "id, category_id, name, description, sku, barcode, price_minor, track_inventory, unit, image_url, is_variable_price, allow_fractional_quantity",
      )
      .eq("organization_id", organizationId)
      .eq("product_type", "simple")
      .eq("is_composite", false)
      .eq("status", "active")
      .order("name", { ascending: true }),
  ]);

  if (categoriesResult.error || productsResult.error) {
    return { ok: false, stage: "catalog" };
  }

  const products = productsResult.data ?? [];
  let costs: CatalogCostEntry[] = [];

  if (includeCosts && products.length > 0) {
    const costEntries = await loadCatalogCostEntries(
      supabase,
      organizationId,
      products.map((product) => product.id),
    );
    if (!costEntries.ok) {
      return { ok: false, stage: "costs" };
    }
    costs = costEntries.costs;
  }

  return {
    ok: true,
    categories: categoriesResult.data ?? [],
    products,
    costs,
  };
}
