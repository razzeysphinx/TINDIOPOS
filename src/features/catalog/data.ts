import "server-only";

import type {
  CatalogCostEntry,
  CatalogExportData,
  CatalogWorkspace,
} from "@/features/catalog/catalog-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { loadCatalogReadBundleResult } from "@/features/catalog/catalog-read-model";

function normalizeRestockPolicy(
  value: string,
): "restock" | "do_not_restock" {
  return value === "do_not_restock" ? value : "restock";
}

function normalizeCompositeInventoryMode(
  value: string,
): "made_to_order" | "stocked_assembly" {
  return value === "stocked_assembly" ? value : "made_to_order";
}

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

  const bundle = await loadCatalogReadBundleResult({ client: supabase, organizationId, needs: ["categories", "stores", "products", "variants", "productStoreSettings", "inventoryLevels", "replenishmentRules", "productUnits", "productComponents"] });
  if (bundle.error) throw new Error(`Unable to load the catalog: ${bundle.error.message}`);

  const products = bundle.data.products.map((product) => ({
    ...product,
    composite_inventory_mode: normalizeCompositeInventoryMode(product.composite_inventory_mode),
  }));
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
    categories: bundle.data.categories,
    stores: bundle.data.stores,
    products,
    variants: bundle.data.variants,
    settings: bundle.data.productStoreSettings.map((setting) => ({
      ...setting,
      restock_policy: normalizeRestockPolicy(setting.restock_policy),
    })),
    costs,
    inventoryLevels: bundle.data.inventoryLevels,
    replenishmentRules: bundle.data.replenishmentRules,
    units: bundle.data.productUnits,
    components: bundle.data.productComponents,
  };
}

export async function loadCatalogExportData(
  context: BusinessContext,
  includeCosts: boolean,
): Promise<CatalogExportData> {
  const supabase = await createClient();
  const organizationId = context.organization.id;

  const bundle = await loadCatalogReadBundleResult({ client: supabase, organizationId, needs: ["categories", "products"] });
  if (bundle.error) {
    return { ok: false, stage: "catalog" };
  }

  const products = bundle.data.products.filter((product) => product.product_type === "simple" && product.is_composite === false && product.status === "active").sort((left, right) => left.name.localeCompare(right.name));
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
    categories: bundle.data.categories,
    products,
    costs,
  };
}
