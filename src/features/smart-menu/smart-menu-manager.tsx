"use client";

import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  ImageIcon,
  LoaderCircle,
  Save,
  Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { saveSmartMenuConfigurationAction } from "@/features/smart-menu/actions";
import type {
  SmartMenuCategory,
  SmartMenuConfiguration,
  SmartMenuProduct,
  SmartMenuStore,
} from "@/features/smart-menu/smart-menu-types";

type Message = { tone: "success" | "error"; text: string } | null;

function createDefaultConfiguration(
  storeId: string,
  categories: SmartMenuCategory[],
  products: SmartMenuProduct[],
): SmartMenuConfiguration {
  return {
    menuId: null,
    storeId,
    isEnabled: false,
    showPrices: true,
    showImages: true,
    showUnavailable: false,
    showVariants: true,
    showModifiers: true,
    categoryIds: categories.map((category) => category.id),
    productIds: products.map((product) => product.id),
  };
}

function moveItem(ids: string[], id: string, offset: -1 | 1) {
  const currentIndex = ids.indexOf(id);
  const nextIndex = currentIndex + offset;
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ids.length) return ids;

  const next = [...ids];
  [next[currentIndex], next[nextIndex]] = [next[nextIndex], next[currentIndex]];
  return next;
}

function moveProductWithinCategory(
  ids: string[],
  product: SmartMenuProduct,
  products: SmartMenuProduct[],
  offset: -1 | 1,
) {
  const productById = new Map(products.map((item) => [item.id, item]));
  const categoryIds = ids.filter((id) => productById.get(id)?.categoryId === product.categoryId);
  const currentIndex = categoryIds.indexOf(product.id);
  const nextId = categoryIds[currentIndex + offset];
  if (!nextId) return ids;

  const currentPosition = ids.indexOf(product.id);
  const nextPosition = ids.indexOf(nextId);
  const next = [...ids];
  [next[currentPosition], next[nextPosition]] = [next[nextPosition], next[currentPosition]];
  return next;
}

export function SmartMenuManager({
  stores,
  categories,
  products,
  configurations,
}: {
  stores: SmartMenuStore[];
  categories: SmartMenuCategory[];
  products: SmartMenuProduct[];
  configurations: SmartMenuConfiguration[];
}) {
  const router = useRouter();
  const initialStoreId = stores[0]?.id ?? "";
  const configurationForStore = (storeId: string) =>
    configurations.find((configuration) => configuration.storeId === storeId)
      ?? createDefaultConfiguration(storeId, categories, products);
  const [selectedStoreId, setSelectedStoreId] = useState(initialStoreId);
  const [draft, setDraft] = useState(() => configurationForStore(initialStoreId));
  const [menuId, setMenuId] = useState(draft.menuId);
  const [message, setMessage] = useState<Message>(null);
  const [isPending, startTransition] = useTransition();

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const productsByCategory = useMemo(() => {
    const grouped = new Map<string, SmartMenuProduct[]>();
    for (const product of products) {
      grouped.set(product.categoryId, [...(grouped.get(product.categoryId) ?? []), product]);
    }
    return grouped;
  }, [products]);
  const selectedCategorySet = useMemo(() => new Set(draft.categoryIds), [draft.categoryIds]);
  const selectedProductSet = useMemo(() => new Set(draft.productIds), [draft.productIds]);
  const selectedCategories = draft.categoryIds.flatMap((id) => {
    const category = categoryById.get(id);
    return category ? [category] : [];
  });

  const productsInCategoryOrder = (categoryId: string) =>
    draft.productIds.filter((productId) => products.find((product) => product.id === productId)?.categoryId === categoryId);

  if (stores.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>An active store is required</CardTitle>
          <CardDescription>
            Add or reactivate a store before publishing a customer-facing Smart Menu.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const selectStore = (storeId: string) => {
    const next = configurationForStore(storeId);
    setSelectedStoreId(storeId);
    setDraft(next);
    setMenuId(next.menuId);
    setMessage(null);
  };

  const updateSetting = <Key extends keyof SmartMenuConfiguration>(
    key: Key,
    value: SmartMenuConfiguration[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleCategory = (categoryId: string) => {
    setDraft((current) => {
      const enabled = current.categoryIds.includes(categoryId);
      return enabled
        ? {
            ...current,
            categoryIds: current.categoryIds.filter((id) => id !== categoryId),
            productIds: current.productIds.filter(
              (productId) => products.find((product) => product.id === productId)?.categoryId !== categoryId,
            ),
          }
        : { ...current, categoryIds: [...current.categoryIds, categoryId] };
    });
  };

  const toggleProduct = (product: SmartMenuProduct) => {
    if (!selectedCategorySet.has(product.categoryId)) return;
    setDraft((current) => ({
      ...current,
      productIds: current.productIds.includes(product.id)
        ? current.productIds.filter((id) => id !== product.id)
        : [...current.productIds, product.id],
    }));
  };

  const save = () => {
    if (draft.isEnabled && (draft.categoryIds.length === 0 || draft.productIds.length === 0)) {
      setMessage({ tone: "error", text: "Select at least one category and one product before publishing Smart Menu." });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await saveSmartMenuConfigurationAction({
        storeId: selectedStoreId,
        isEnabled: draft.isEnabled,
        showPrices: draft.showPrices,
        showImages: draft.showImages,
        showUnavailable: draft.showUnavailable,
        showVariants: draft.showVariants,
        showModifiers: draft.showModifiers,
        categoryIds: draft.categoryIds,
        productIds: draft.productIds,
      });
      setMessage({ tone: result.ok ? "success" : "error", text: result.message });
      if (result.ok) {
        setMenuId(result.data?.menuId ?? null);
        router.refresh();
      }
    });
  };

  const copyPublicLink = async () => {
    if (!menuId) return;
    const url = new URL(`/menu/${menuId}`, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ tone: "success", text: "Public Smart Menu link copied." });
    } catch {
      setMessage({ tone: "error", text: `Copy this Smart Menu link: ${url}` });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Menu publishing</CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              Smart Menu reads the current catalog. It does not create a second product list, cart, or ordering flow.
            </CardDescription>
          </div>
          <Badge variant={draft.isEnabled ? "secondary" : "outline"}>
            {draft.isEnabled ? "Public menu on" : "Public menu off"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          <Label className="grid max-w-sm gap-1.5">
            <span>Store</span>
            <select
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              disabled={isPending}
              onChange={(event) => selectStore(event.target.value)}
              value={selectedStoreId}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </Label>

          <div className="flex flex-wrap gap-2">
            {menuId && draft.isEnabled ? (
              <>
                <Button disabled={isPending} onClick={copyPublicLink} type="button" variant="outline">
                  <Copy /> Copy public link
                </Button>
                <Button onClick={() => window.open(`/menu/${menuId}`, "_blank", "noopener,noreferrer")} type="button" variant="outline">
                  <ExternalLink /> Preview public menu
                </Button>
              </>
            ) : <p className="text-sm text-muted-foreground">{menuId ? "This store has a Smart Menu link, but the menu is currently turned off." : "Save once to create this store&apos;s shareable Smart Menu link."}</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customer display</CardTitle>
          <CardDescription>Choose the catalog information customers can see after you publish this menu.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <Toggle checked={draft.isEnabled} disabled={isPending} label="Publish Smart Menu" onChange={(value) => updateSetting("isEnabled", value)} />
          <Toggle checked={draft.showPrices} disabled={isPending} label="Show current prices" onChange={(value) => updateSetting("showPrices", value)} />
          <Toggle checked={draft.showImages} disabled={isPending} label="Show catalog images" onChange={(value) => updateSetting("showImages", value)} />
          <Toggle checked={draft.showUnavailable} disabled={isPending} label="Show unavailable as sold out" onChange={(value) => updateSetting("showUnavailable", value)} />
          <Toggle checked={draft.showVariants} disabled={isPending} label="Show active variants" onChange={(value) => updateSetting("showVariants", value)} />
          <Toggle checked={draft.showModifiers} disabled={isPending} label="Show active modifiers" onChange={(value) => updateSetting("showModifiers", value)} />
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Categories and order</CardTitle>
            <CardDescription>Select the categories customers can browse, then set their display order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {categories.map((category) => {
              const selected = selectedCategorySet.has(category.id);
              const index = draft.categoryIds.indexOf(category.id);
              return (
                <div className="flex items-center gap-2 rounded-lg border p-3" key={category.id}>
                  <input
                    aria-label={`Show ${category.name}`}
                    checked={selected}
                    disabled={isPending}
                    onChange={() => toggleCategory(category.id)}
                    type="checkbox"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.name}</span>
                  {selected ? (
                    <div className="flex shrink-0 gap-1">
                      <Button aria-label={`Move ${category.name} up`} disabled={isPending || index === 0} onClick={() => updateSetting("categoryIds", moveItem(draft.categoryIds, category.id, -1))} size="icon-sm" type="button" variant="ghost"><ArrowUp /></Button>
                      <Button aria-label={`Move ${category.name} down`} disabled={isPending || index === draft.categoryIds.length - 1} onClick={() => updateSetting("categoryIds", moveItem(draft.categoryIds, category.id, 1))} size="icon-sm" type="button" variant="ghost"><ArrowDown /></Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
            {categories.length === 0 ? <EmptyCatalogMessage /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Products and order</CardTitle>
            <CardDescription>Pick products within the selected categories. Turning off a category removes its products from this menu.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {selectedCategories.map((category) => {
              const categoryProducts = productsByCategory.get(category.id) ?? [];
              return (
                <section aria-labelledby={`smart-menu-category-${category.id}`} className="space-y-2" key={category.id}>
                  <div className="flex items-center justify-between gap-3"><h3 className="font-medium" id={`smart-menu-category-${category.id}`}>{category.name}</h3><Badge variant="outline">{categoryProducts.filter((product) => selectedProductSet.has(product.id)).length} selected</Badge></div>
                  <div className="space-y-2">
                    {categoryProducts.map((product) => {
                      const selected = selectedProductSet.has(product.id);
                      const categoryProductIds = productsInCategoryOrder(category.id);
                      const index = categoryProductIds.indexOf(product.id);
                      return (
                        <div className="flex items-center gap-2 rounded-lg border p-3" key={product.id}>
                          {product.imageUrl ? <span aria-hidden="true" className="size-8 shrink-0 rounded-md border bg-cover bg-center" style={{ backgroundImage: `url(${product.imageUrl})` }} /> : <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-4" /></span>}
                          <input aria-label={`Show ${product.name}`} checked={selected} disabled={isPending} onChange={() => toggleProduct(product)} type="checkbox" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                          {selected ? <div className="flex shrink-0 gap-1"><Button aria-label={`Move ${product.name} up`} disabled={isPending || index === 0} onClick={() => updateSetting("productIds", moveProductWithinCategory(draft.productIds, product, products, -1))} size="icon-sm" type="button" variant="ghost"><ArrowUp /></Button><Button aria-label={`Move ${product.name} down`} disabled={isPending || index === categoryProductIds.length - 1} onClick={() => updateSetting("productIds", moveProductWithinCategory(draft.productIds, product, products, 1))} size="icon-sm" type="button" variant="ghost"><ArrowDown /></Button></div> : null}
                        </div>
                      );
                    })}
                    {categoryProducts.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No active non-composite products are assigned to this category.</p> : null}
                  </div>
                </section>
              );
            })}
            {selectedCategories.length === 0 ? <EmptyCatalogMessage /> : null}
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        <Button disabled={isPending} onClick={save} type="button">
          {isPending ? <LoaderCircle className="animate-spin" /> : <Save />}
          Save Smart Menu
        </Button>
        {message ? <p aria-live="polite" className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{message.text}</p> : null}
      </div>
    </div>
  );
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return <Label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium"><input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />{label}</Label>;
}

function EmptyCatalogMessage() {
  return <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"><Settings2 className="mx-auto mb-2 size-5" aria-hidden="true" />Create active categories and products in Catalog before configuring this Smart Menu.</div>;
}
