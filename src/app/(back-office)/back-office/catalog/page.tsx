import {
  Barcode,
  Boxes,
  Package,
  PackageOpen,
  Tag,
} from "lucide-react";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
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
  EditProductButton,
  ProductArchiveButton,
  ProductAvailabilityButton,
} from "@/features/catalog/catalog-forms";
import { ProductLabelPrintButton } from "@/features/catalog/catalog-label-print";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { loadCatalogWorkspace } from "@/features/catalog/data";
import { buildProductUnitOptions } from "@/features/catalog/product-unit-options";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Catalog" };

export default async function CatalogPage() {
  const context = await requireBackOfficePermission("products.manage");
  const canManage = hasPermission(context, "products.manage");
  const canViewCost = hasPermission(context, "products.view_cost");

  const { categories, stores, products, variants, settings, costs } =
    await loadCatalogWorkspace(context, { includeCosts: canViewCost });

  const activeStores = stores.filter((store) => store.is_active);
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const costByItem = new Map(
    costs.map((cost) => [`${cost.product_id}|${cost.variant_id ?? ""}`, cost.cost_minor]),
  );
  const currency = context.organization.currency_code;
  const unitOptions = buildProductUnitOptions(products.map((product) => product.unit));

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
            {canManage && activeStores.length > 0 ? (
              <CreateProductForm
                canViewCost={canViewCost}
                canTrackInventory={context.features.inventory}
                canUseWeightedProducts={context.features.weighted_products}
                categories={categories
                  .filter((category) => !category.is_archived)
                  .map(({ id, name }) => ({ id, name }))}
                stores={activeStores.map(({ id, name }) => ({ id, name }))}
                unitOptions={unitOptions}
              />
            ) : null}
          </div>
        }
      />

      {canManage && activeStores.length > 0 ? (
        <>
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
        <BackOfficeStateCard
          description="Add or reactivate a store before creating the first product."
          icon={<PackageOpen className="size-5" aria-hidden="true" />}
          title="An active store is required"
        />
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
                            {canManage ? (
                              <div className="mt-2">
                                <ProductLabelPrintButton
                                  barcode={variant.barcode}
                                  price={formatMinorMoney(variant.price_minor, currency)}
                                  productName={`${product.name} — ${variant.name}`}
                                  sku={variant.sku}
                                />
                              </div>
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
                    <div className="flex flex-wrap justify-end gap-1 border-t pt-3">
                      {product.product_type !== "variable" ? (
                        <ProductLabelPrintButton
                          barcode={product.barcode}
                          price={formatMinorMoney(product.price_minor, currency)}
                          productName={product.name}
                          sku={product.sku}
                        />
                      ) : null}
                      <EditProductButton
                        canTrackInventory={context.features.inventory}
                        canUseWeightedProducts={context.features.weighted_products}
                        canViewCost={canViewCost}
                        categories={categories
                          .filter((category) => !category.is_archived)
                          .map(({ id, name }) => ({ id, name }))}
                        stores={activeStores.map(({ id, name }) => ({ id, name }))}
                        unitOptions={unitOptions}
                        product={{
                          id: product.id,
                          name: product.name,
                          description: product.description,
                          categoryId: product.category_id,
                          productType: product.product_type as "simple" | "variable" | "composite",
                          sku: product.sku,
                          barcode: product.barcode,
                          priceMinor: product.price_minor,
                          costMinor: productCost ?? 0,
                          trackInventory: product.track_inventory,
                          unit: product.unit,
                          imageUrl: product.image_url,
                          isVariablePrice: product.is_variable_price,
                          allowFractionalQuantity: product.allow_fractional_quantity,
                          availableStoreIds: productSettings
                            .filter((setting) => setting.is_available)
                            .map((setting) => setting.store_id),
                        }}
                      />
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
        <BackOfficeStateCard
          description="Create the first product after account and organization setup."
          icon={<PackageOpen className="size-5" aria-hidden="true" />}
          title="No products yet"
        />
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
    <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="shrink-0">{label}:</span>
      <span className="min-w-0 truncate font-mono text-xs">{value || "Not set"}</span>
    </div>
  );
}
