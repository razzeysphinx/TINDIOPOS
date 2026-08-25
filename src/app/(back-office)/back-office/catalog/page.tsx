import {
  Barcode,
  Boxes,
  Package,
  PackageOpen,
  Tag,
} from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CreateProductForm,
  CatalogCsvTools,
  CatalogExtensionForms,
  ProductArchiveButton,
  ProductAvailabilityButton,
} from "@/features/catalog/catalog-forms";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const context = await requireBusinessContext();
  const supabase = await createClient();
  const organizationId = context.organization.id;
  const canManage = hasPermission(context, "products.manage");
  const canViewCost = hasPermission(context, "products.view_cost");

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
  let costs: Array<{
    product_id: string;
    variant_id: string | null;
    cost_minor: number;
  }> = [];

  if (canViewCost && products.length > 0) {
    const costsResult = await supabase.rpc("get_catalog_costs", {
      target_organization_id: organizationId,
      requested_product_ids: products.map((product) => product.id),
    });

    if (costsResult.error) {
      throw new Error(`Unable to load product costs: ${costsResult.error.message}`);
    }

    costs = costsResult.data ?? [];
  }

  const categories = categoriesResult.data ?? [];
  const stores = storesResult.data ?? [];
  const activeStores = stores.filter((store) => store.is_active);
  const variants = variantsResult.data ?? [];
  const settings = settingsResult.data ?? [];
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const costByItem = new Map(
    costs.map((cost) => [`${cost.product_id}|${cost.variant_id ?? ""}`, cost.cost_minor]),
  );
  const currency = context.organization.currency_code;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Products"
        title="Catalog"
        description="Manage sellable products, variants, identifiers, pricing, and per-store availability."
        action={
          <div className="flex flex-wrap justify-end gap-2">
            <Badge variant={canManage ? "secondary" : "outline"}>
              {canManage ? "Management access" : "View access"}
            </Badge>
            {canViewCost ? <Badge variant="outline">Cost visible</Badge> : null}
          </div>
        }
      />

      {canManage && activeStores.length > 0 ? (
        <>
          <CreateProductForm
            canViewCost={canViewCost}
            canTrackInventory={context.features.inventory}
            canUseWeightedProducts={context.features.weighted_products}
            categories={categories
              .filter((category) => !category.is_archived)
              .map(({ id, name }) => ({ id, name }))}
            stores={activeStores.map(({ id, name }) => ({ id, name }))}
          />
          <CatalogExtensionForms
            products={products.map((product) => ({
              id: product.id,
              name: product.name,
              productType: product.product_type,
              isComposite: product.is_composite,
            }))}
            stores={activeStores.map(({ id, name }) => ({ id, name }))}
          />
          <CatalogCsvTools
            categories={categories
              .filter((category) => !category.is_archived)
              .map(({ id, name }) => ({ id, name }))}
            stores={activeStores.map(({ id, name }) => ({ id, name }))}
          />
        </>
      ) : canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>An active store is required</CardTitle>
            <CardDescription>
              Add or reactivate a store before creating the first product.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {products.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {products.map((product) => {
            const productVariants = variants.filter(
              (variant) => variant.product_id === product.id,
            );
            const productSettings = settings.filter(
              (setting) => setting.product_id === product.id,
            );
            const productCost = costByItem.get(`${product.id}|`);
            const archived = product.status === "archived";

            return (
              <Card className={archived ? "opacity-65" : undefined} key={product.id}>
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                      <Package className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <CardTitle className="truncate">{product.name}</CardTitle>
                      <CardDescription className="mt-1 line-clamp-2">
                        {product.description ||
                          categoryNames.get(product.category_id ?? "") ||
                          "Uncategorized product"}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge variant={archived ? "outline" : "secondary"}>
                    {archived ? "Archived" : "Active"}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {product.is_composite ? "Composite" : product.product_type === "simple" ? "Simple" : "Variants"}
                    </Badge>
                    <Badge variant="outline">{product.unit}</Badge>
                    {product.is_variable_price ? <Badge variant="outline">Price entered at sale</Badge> : null}
                    {product.allow_fractional_quantity ? <Badge variant="outline">Fractional quantity</Badge> : null}
                    <Badge variant={product.track_inventory ? "secondary" : "outline"}>
                      <Boxes aria-hidden="true" />
                      {product.track_inventory ? "Inventory tracked" : "Not tracked"}
                    </Badge>
                  </div>

                  {product.image_url ? (
                    <img alt="" className="h-20 w-20 rounded-lg border object-cover" src={product.image_url} />
                  ) : null}

                  {product.product_type !== "variable" ? (
                    <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                      <div>
                        <p className="text-xs text-muted-foreground">Selling price</p>
                        <p className="mt-1 font-semibold">
                          {formatMinorMoney(product.price_minor, currency)}
                        </p>
                      </div>
                      {canViewCost ? (
                        <div>
                          <p className="text-xs text-muted-foreground">Cost</p>
                          <p className="mt-1 font-medium">
                            {formatMinorMoney(productCost ?? 0, currency)}
                          </p>
                        </div>
                      ) : null}
                      <Identifier label="SKU" value={product.sku} />
                      <Identifier label="Barcode" value={product.barcode} barcode />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {productVariants.map((variant) => (
                        <div
                          className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                          key={variant.id}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{variant.name}</p>
                            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                              {variant.sku || variant.barcode || "No identifier"}
                            </p>
                          </div>
                          <div className="text-left sm:text-right">
                            <p className="font-semibold">
                              {formatMinorMoney(variant.price_minor, currency)}
                            </p>
                            {canViewCost ? (
                              <p className="text-xs text-muted-foreground">
                                Cost {formatMinorMoney(costByItem.get(`${product.id}|${variant.id}`) ?? 0, currency)}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Store availability
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {stores.map((store) => {
                        const setting = productSettings.find(
                          (candidate) => candidate.store_id === store.id,
                        );

                        return canManage ? (
                          <ProductAvailabilityButton
                            isAvailable={setting?.is_available ?? false}
                            key={store.id}
                            productId={product.id}
                            storeId={store.id}
                            storeName={store.name}
                          />
                        ) : (
                          <Badge
                            key={store.id}
                            variant={setting?.is_available ? "secondary" : "outline"}
                          >
                            {store.name}: {setting?.is_available ? "On" : "Off"}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>

                  {canManage ? (
                    <div className="flex justify-end border-t pt-3">
                      <ProductArchiveButton
                        isArchived={archived}
                        productId={product.id}
                      />
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </section>
      ) : (
        <Card>
          <CardHeader className="items-center py-12 text-center">
            <PackageOpen className="size-9 text-muted-foreground" aria-hidden="true" />
            <CardTitle>No products yet</CardTitle>
            <CardDescription>
              Create the first product after account and organization setup.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}

function Identifier({
  label,
  value,
  barcode = false,
}: {
  label: string;
  value: string | null;
  barcode?: boolean;
}) {
  const Icon = barcode ? Barcode : Tag;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{label}:</span>
      <span className="truncate font-mono text-xs">{value || "Not set"}</span>
    </div>
  );
}
