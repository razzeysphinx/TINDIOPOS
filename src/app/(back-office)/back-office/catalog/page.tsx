import { PackageOpen } from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { PageHeader } from "@/components/back-office/page-header";
import { CatalogProductWorkspace } from "@/features/catalog/catalog-product-workspace";
import { loadCatalogWorkspace } from "@/features/catalog/data";
import { buildProductUnitOptions } from "@/features/catalog/product-unit-options";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Catalog" };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const context = await requireBackOfficePermission("products.manage");
  const parameters = await searchParams;
  const initialStatus = parameters.status === "archived" || parameters.status === "all" ? parameters.status : "active";
  const canViewCost = hasPermission(context, "products.view_cost");
  const workspace = await loadCatalogWorkspace(context, { includeCosts: canViewCost });
  const activeStores = workspace.stores.filter((store) => store.is_active);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Products"
        title="Catalog"
        description="Manage the products your business sells."
      />

      {activeStores.length > 0 ? (
        <CatalogProductWorkspace
          {...workspace}
          canTrackInventory={context.features.inventory}
          canUseWeightedProducts={context.features.weighted_products}
          canViewCost={canViewCost}
          currencyCode={context.organization.currency_code}
          initialStatus={initialStatus}
          unitOptions={buildProductUnitOptions(workspace.products.map((product) => product.unit))}
        />
      ) : (
        <BackOfficeStateCard
          description="Add or reactivate a store before creating the first product."
          icon={<PackageOpen className="size-5" aria-hidden="true" />}
          title="An active store is required"
        />
      )}
    </div>
  );
}
