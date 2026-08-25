import "server-only";

import type {
  CatalogCostEntry,
  CatalogExportData,
  CatalogWorkspace,
} from "@/features/catalog/catalog-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadCatalogWorkspace(
  context: BusinessContext,
  options: { includeCosts?: boolean } = {},
): Promise<CatalogWorkspace> {
  const supabase = await createClient();
  const organizationId = context.organization.id;

  const [categoriesResult, storesResult, productsResult, variantsResult, settingsResult] =
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
        .select("product_id, store_id, is_available, price_override_minor, low_stock_level")
        .eq("organization_id", organizationId),
    ]);

  const baseError = [
    categoriesResult,
    storesResult,
    productsResult,
    variantsResult,
    settingsResult,
  ].find((result) => result.error)?.error;

  if (baseError) {
    throw new Error(`Unable to load the catalog: ${baseError.message}`);
  }

  const products = productsResult.data ?? [];
  let costs: CatalogCostEntry[] = [];

  if (options.includeCosts && products.length > 0) {
    const costsResult = await supabase.rpc("get_catalog_costs", {
      target_organization_id: organizationId,
      requested_product_ids: products.map((product) => product.id),
    });

    if (costsResult.error) {
      throw new Error(`Unable to load product costs: ${costsResult.error.message}`);
    }

    costs = costsResult.data ?? [];
  }

  return {
    categories: categoriesResult.data ?? [],
    stores: storesResult.data ?? [],
    products,
    variants: variantsResult.data ?? [],
    settings: settingsResult.data ?? [],
    costs,
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
    const costsResult = await supabase.rpc("get_catalog_costs", {
      target_organization_id: organizationId,
      requested_product_ids: products.map((product) => product.id),
    });

    if (costsResult.error) {
      return { ok: false, stage: "costs" };
    }

    costs = costsResult.data ?? [];
  }

  return {
    ok: true,
    categories: categoriesResult.data ?? [],
    products,
    costs,
  };
}
