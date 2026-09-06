"use client";

import QRCode from "qrcode";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  ImageIcon,
  LoaderCircle,
  QrCode,
  Save,
  Search,
  Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUnsavedChanges } from "@/components/unsaved-changes/unsaved-changes-provider";
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

function equalConfiguration(first: SmartMenuConfiguration, second: SmartMenuConfiguration) {
  return first.storeId === second.storeId
    && first.isEnabled === second.isEnabled
    && first.showPrices === second.showPrices
    && first.showImages === second.showImages
    && first.showUnavailable === second.showUnavailable
    && first.showVariants === second.showVariants
    && first.showModifiers === second.showModifiers
    && first.categoryIds.join("|") === second.categoryIds.join("|")
    && first.productIds.join("|") === second.productIds.join("|");
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
  const initialConfiguration = configurationForStore(initialStoreId);
  const [selectedStoreId, setSelectedStoreId] = useState(initialStoreId);
  const [draft, setDraft] = useState(initialConfiguration);
  const [persistedDraft, setPersistedDraft] = useState(initialConfiguration);
  const [menuId, setMenuId] = useState(initialConfiguration.menuId);
  const [message, setMessage] = useState<Message>(null);
  const [search, setSearch] = useState("");
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isDirty = !equalConfiguration(draft, persistedDraft);
  const { requestNavigation } = useUnsavedChanges({
    copy: {
      title: "Discard unsaved Smart Menu changes?",
      description: "Your menu display, ordering, or publication changes have not been saved for this store.",
    },
    isDirty,
    isSaving: isPending,
  });

  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );
  const productById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
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
  const menuCategories = useMemo(() => [
    ...draft.categoryIds.flatMap((id) => categoryById.get(id) ? [categoryById.get(id)!] : []),
    ...categories.filter((category) => !selectedCategorySet.has(category.id)),
  ], [categories, categoryById, draft.categoryIds, selectedCategorySet]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleCategoryCount = draft.categoryIds.length;
  const visibleProductCount = draft.productIds.length;

  const publicPath = menuId ? `/menu/${menuId}` : null;

  if (stores.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>An active store is required</CardTitle>
          <CardDescription>Add or reactivate a store before publishing a customer-facing Smart Menu.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const selectStore = (storeId: string) => {
    const next = configurationForStore(storeId);
    setSelectedStoreId(storeId);
    setDraft(next);
    setPersistedDraft(next);
    setMenuId(next.menuId);
    setExpandedCategoryIds(new Set());
    setSearch("");
    setMessage(null);
  };

  const requestStoreChange = (storeId: string) => {
    if (storeId === selectedStoreId) return;
    requestNavigation(() => selectStore(storeId));
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
            productIds: current.productIds.filter((productId) => productById.get(productId)?.categoryId !== categoryId),
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

  const toggleCategoryExpansion = (categoryId: string) => {
    setExpandedCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const save = (publish: boolean) => {
    const nextDraft = { ...draft, isEnabled: publish };
    if (publish && (nextDraft.categoryIds.length === 0 || nextDraft.productIds.length === 0)) {
      setMessage({ tone: "error", text: "Choose at least one visible category and product before publishing this menu." });
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const result = await saveSmartMenuConfigurationAction({
        storeId: selectedStoreId,
        isEnabled: nextDraft.isEnabled,
        showPrices: nextDraft.showPrices,
        showImages: nextDraft.showImages,
        showUnavailable: nextDraft.showUnavailable,
        showVariants: nextDraft.showVariants,
        showModifiers: nextDraft.showModifiers,
        categoryIds: nextDraft.categoryIds,
        productIds: nextDraft.productIds,
      });
      setMessage({ tone: result.ok ? "success" : "error", text: result.message });
      if (result.ok) {
        const savedDraft = { ...nextDraft, menuId: result.data?.menuId ?? menuId };
        setDraft(savedDraft);
        setPersistedDraft(savedDraft);
        setMenuId(savedDraft.menuId);
        router.refresh();
      }
    });
  };

  const copyPublicLink = async () => {
    if (!publicPath) return;
    const publicUrl = new URL(publicPath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage({ tone: "success", text: "Public Smart Menu link copied." });
    } catch {
      setMessage({ tone: "error", text: `Copy this Smart Menu link: ${publicUrl}` });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">Customer menu</p>
            <CardTitle className="mt-1">Smart Menu</CardTitle>
            <CardDescription className="mt-1 max-w-2xl">Create and publish a customer-facing menu using your existing Catalog. Product details, prices, and availability remain managed by Catalog.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={persistedDraft.isEnabled ? "secondary" : "outline"}>{persistedDraft.isEnabled ? "Published" : "Draft"}</Badge>
            {isDirty ? <Badge variant="outline">Unsaved changes</Badge> : null}
            <Button onClick={() => setIsPreviewOpen(true)} type="button" variant="outline"><Eye />Preview menu</Button>
            {publicPath ? <Button disabled={!persistedDraft.isEnabled} onClick={() => setIsQrOpen(true)} type="button" variant="outline"><QrCode />Share / QR</Button> : null}
            {persistedDraft.isEnabled ? <Button disabled={isPending} onClick={() => save(true)} type="button"><Save />{isPending ? "Publishing..." : "Publish changes"}</Button> : <Button disabled={isPending} onClick={() => save(true)} type="button"><Save />{isPending ? "Publishing..." : "Publish menu"}</Button>}
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 border-t pt-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
          <Label className="grid gap-1.5 text-sm font-medium">
            <span>Store</span>
            <select
              className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              disabled={isPending}
              onChange={(event) => requestStoreChange(event.target.value)}
              value={selectedStoreId}
            >
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </Label>
          <dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3">
            <SummaryMetric label="Visible categories" value={`${visibleCategoryCount} / ${categories.length}`} />
            <SummaryMetric label="Visible products" value={`${visibleProductCount} / ${products.length}`} />
            <SummaryMetric label="Menu status" value={persistedDraft.isEnabled ? "Published" : "Draft"} />
          </dl>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,.42fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Menu status</CardTitle>
              <CardDescription>{persistedDraft.isEnabled ? "This menu is publicly available at the link below." : "This menu is not visible to customers until you publish it."}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2"><Badge variant={persistedDraft.isEnabled ? "secondary" : "outline"}>{persistedDraft.isEnabled ? "Published" : "Draft"}</Badge>{menuId ? <code className="max-w-full truncate rounded-md bg-muted px-2 py-1 text-xs">{publicPath}</code> : <span className="text-sm text-muted-foreground">Save this draft once to create the store-specific public link.</span>}</div>
              <div className="flex flex-wrap gap-2">
                {publicPath ? <><Button disabled={!persistedDraft.isEnabled} onClick={copyPublicLink} type="button" variant="outline"><Copy />Copy link</Button><Button disabled={!persistedDraft.isEnabled} onClick={() => window.open(publicPath, "_blank", "noopener,noreferrer")} type="button" variant="outline"><ExternalLink />Open menu</Button><Button disabled={!persistedDraft.isEnabled} onClick={() => setIsQrOpen(true)} type="button" variant="outline"><QrCode />Show QR</Button></> : <Button disabled={isPending} onClick={() => save(false)} type="button" variant="outline"><Save />Save draft</Button>}
                {persistedDraft.isEnabled ? <Button disabled={isPending} onClick={() => save(false)} type="button" variant="destructive">{isPending ? <LoaderCircle className="animate-spin" /> : null}Unpublish menu</Button> : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Customer display</CardTitle>
              <CardDescription>Choose only the customer-safe Catalog information to show. Cost, inventory quantities, supplier data, and internal records are never exposed here.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 md:grid-cols-2">
              <fieldset className="space-y-2"><legend className="text-sm font-medium">Product information</legend><Toggle checked={draft.showPrices} disabled={isPending} label="Show prices" onChange={(value) => updateSetting("showPrices", value)} /><Toggle checked={draft.showImages} disabled={isPending} label="Show product images" onChange={(value) => updateSetting("showImages", value)} /><Toggle checked={draft.showVariants} disabled={isPending} label="Show active variants" onChange={(value) => updateSetting("showVariants", value)} /><Toggle checked={draft.showModifiers} disabled={isPending} label="Show active modifiers" onChange={(value) => updateSetting("showModifiers", value)} /></fieldset>
              <fieldset className="space-y-2"><legend className="text-sm font-medium">Availability</legend><Label className="grid gap-1.5 text-sm font-medium"><span>Unavailable products</span><select className="h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" disabled={isPending} onChange={(event) => updateSetting("showUnavailable", event.target.value === "sold-out")} value={draft.showUnavailable ? "sold-out" : "hide"}><option value="hide">Hide unavailable products</option><option value="sold-out">Show as sold out</option></select></Label><p className="text-sm leading-6 text-muted-foreground">Choose one customer-facing availability behavior. The menu never displays exact stock quantities.</p></fieldset>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Menu content</CardTitle>
              <CardDescription>Choose what customers see and order it using the existing move controls. Categories stay collapsed until you need to inspect their products.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Label className="relative block"><span className="sr-only">Search categories or products</span><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search categories or products..." value={search} /></Label>
              <div className="space-y-2">
                {menuCategories.map((category) => {
                  const categoryProducts = productsByCategory.get(category.id) ?? [];
                  const matchesCategory = category.name.toLocaleLowerCase().includes(normalizedSearch);
                  const matchesProducts = categoryProducts.filter((product) => product.name.toLocaleLowerCase().includes(normalizedSearch));
                  if (normalizedSearch && !matchesCategory && matchesProducts.length === 0) return null;
                  const selected = selectedCategorySet.has(category.id);
                  const visibleProducts = categoryProducts.filter((product) => selectedProductSet.has(product.id)).length;
                  const selectedProductOrder = draft.productIds.filter((id) => productById.get(id)?.categoryId === category.id);
                  const productsInDisplayOrder = [
                    ...selectedProductOrder.flatMap((id) => productById.get(id) ? [productById.get(id)!] : []),
                    ...categoryProducts.filter((product) => !selectedProductSet.has(product.id)),
                  ];
                  const productsToShow = normalizedSearch && !matchesCategory
                    ? productsInDisplayOrder.filter((product) => product.name.toLocaleLowerCase().includes(normalizedSearch))
                    : productsInDisplayOrder;
                  const expanded = normalizedSearch.length > 0 || expandedCategoryIds.has(category.id);
                  const categoryIndex = draft.categoryIds.indexOf(category.id);

                  return <section className="rounded-xl border" key={category.id}>
                    <div className="flex min-h-12 items-center gap-2 p-2.5">
                      <Button aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${category.name}`} onClick={() => toggleCategoryExpansion(category.id)} size="icon-sm" type="button" variant="ghost">{expanded ? <ChevronDown /> : <ChevronRight />}</Button>
                      <input aria-label={`Show ${category.name} category`} checked={selected} disabled={isPending} onChange={() => toggleCategory(category.id)} type="checkbox" />
                      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{category.name}</p><p className="text-xs text-muted-foreground">{visibleProducts} visible of {categoryProducts.length} products</p></div>
                      <Badge variant={selected ? "secondary" : "outline"}>{selected ? "Visible" : "Hidden"}</Badge>
                      {selected ? <div className="flex shrink-0 gap-1"><Button aria-label={`Move ${category.name} up`} disabled={isPending || categoryIndex === 0} onClick={() => updateSetting("categoryIds", moveItem(draft.categoryIds, category.id, -1))} size="icon-sm" type="button" variant="ghost"><ArrowUp /></Button><Button aria-label={`Move ${category.name} down`} disabled={isPending || categoryIndex === draft.categoryIds.length - 1} onClick={() => updateSetting("categoryIds", moveItem(draft.categoryIds, category.id, 1))} size="icon-sm" type="button" variant="ghost"><ArrowDown /></Button></div> : null}
                    </div>
                    {expanded ? <div className="space-y-1 border-t p-2.5">{productsToShow.map((product) => {
                      const productSelected = selectedProductSet.has(product.id);
                      const productIndex = selectedProductOrder.indexOf(product.id);
                      return <div className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted/60" key={product.id}>
                        {product.imageUrl ? <span aria-hidden="true" className="size-7 shrink-0 rounded-md border bg-cover bg-center" style={{ backgroundImage: `url(${product.imageUrl})` }} /> : <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"><ImageIcon className="size-3.5" /></span>}
                        <input aria-label={`Show ${product.name}`} checked={productSelected} disabled={isPending || !selected} onChange={() => toggleProduct(product)} type="checkbox" />
                        <span className="min-w-0 flex-1 truncate text-sm">{product.name}</span>
                        {productSelected ? <div className="flex shrink-0 gap-1"><Button aria-label={`Move ${product.name} up`} disabled={isPending || productIndex === 0} onClick={() => updateSetting("productIds", moveProductWithinCategory(draft.productIds, product, products, -1))} size="icon-sm" type="button" variant="ghost"><ArrowUp /></Button><Button aria-label={`Move ${product.name} down`} disabled={isPending || productIndex === selectedProductOrder.length - 1} onClick={() => updateSetting("productIds", moveProductWithinCategory(draft.productIds, product, products, 1))} size="icon-sm" type="button" variant="ghost"><ArrowDown /></Button></div> : null}
                      </div>;
                    })}{productsToShow.length === 0 ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No matching active products in this category.</p> : null}</div> : null}
                  </section>;
                })}
                {menuCategories.length === 0 ? <EmptyCatalogMessage /> : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <SmartMenuPreview categoryById={categoryById} draft={draft} productById={productById} selectedProductSet={selectedProductSet} />
      </div>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-background/95 p-3 shadow-sm backdrop-blur">
        <div>{message ? <p aria-live="polite" className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-primary"}>{message.text}</p> : <p className="text-sm text-muted-foreground">{isDirty ? "Unsaved changes" : "All changes saved"}</p>}</div>
        <div className="flex flex-wrap gap-2"><Button onClick={() => setIsPreviewOpen(true)} type="button" variant="outline"><Eye />Preview</Button><Button disabled={isPending} onClick={() => save(draft.isEnabled)} type="button" variant="outline">{isPending ? <LoaderCircle className="animate-spin" /> : <Save />}{draft.isEnabled ? "Save published changes" : "Save draft"}</Button>{!persistedDraft.isEnabled || !draft.isEnabled ? <Button disabled={isPending} onClick={() => save(true)} type="button">{isPending ? <LoaderCircle className="animate-spin" /> : <Check />}Publish changes</Button> : null}</div>
      </div>

      <SmartMenuPreviewDialog categoryById={categoryById} draft={draft} onOpenChange={setIsPreviewOpen} open={isPreviewOpen} productById={productById} selectedProductSet={selectedProductSet} />
      <SmartMenuQrDialog onOpenChange={setIsQrOpen} open={isQrOpen} publicPath={publicPath} />
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>;
}

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled: boolean; label: string; onChange: (value: boolean) => void }) {
  return <Label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium"><input checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />{label}</Label>;
}

function SmartMenuPreview({
  categoryById,
  draft,
  productById,
  selectedProductSet,
}: PreviewProps) {
  const visibleCategories = draft.categoryIds.flatMap((id) => categoryById.get(id) ? [categoryById.get(id)!] : []);
  return <Card className="h-fit xl:sticky xl:top-20"><CardHeader><CardTitle>Customer preview</CardTitle><CardDescription>Previewing the current unsaved configuration. Customers continue to see the last published menu until you publish changes.</CardDescription></CardHeader><CardContent className="max-h-[34rem] space-y-4 overflow-y-auto"><MenuPreviewContent categories={visibleCategories} draft={draft} productById={productById} selectedProductSet={selectedProductSet} /></CardContent></Card>;
}

type PreviewProps = {
  categoryById: Map<string, SmartMenuCategory>;
  draft: SmartMenuConfiguration;
  productById: Map<string, SmartMenuProduct>;
  selectedProductSet: Set<string>;
};

function MenuPreviewContent({ categories, draft, productById, selectedProductSet }: Pick<PreviewProps, "draft" | "productById" | "selectedProductSet"> & { categories: SmartMenuCategory[] }) {
  return <div className="space-y-4">{categories.map((category) => {
    const categoryProducts = draft.productIds.flatMap((id) => {
      const product = productById.get(id);
      return product?.categoryId === category.id && selectedProductSet.has(id) ? [product] : [];
    });
    return <section key={category.id}><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{category.name}</h3><Badge variant="outline">{categoryProducts.length}</Badge></div><div className="mt-2 space-y-2">{categoryProducts.slice(0, 8).map((product) => <div className="flex items-center gap-2 rounded-lg border p-2" key={product.id}>{draft.showImages ? (product.imageUrl ? <span aria-hidden="true" className="size-7 shrink-0 rounded bg-cover bg-center" style={{ backgroundImage: `url(${product.imageUrl})` }} /> : <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded bg-muted"><ImageIcon className="size-3.5" /></span>) : null}<span className="min-w-0 flex-1 truncate text-sm">{product.name}</span></div>)}{categoryProducts.length > 8 ? <p className="text-xs text-muted-foreground">+{categoryProducts.length - 8} more visible products</p> : null}{categoryProducts.length === 0 ? <p className="text-xs text-muted-foreground">No visible products</p> : null}</div></section>;
  })}{categories.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Choose categories and products to preview this menu.</p> : null}</div>;
}

function SmartMenuPreviewDialog(props: PreviewProps & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const visibleCategories = props.draft.categoryIds.flatMap((id) => props.categoryById.get(id) ? [props.categoryById.get(id)!] : []);
  return <Dialog.Root onOpenChange={props.onOpenChange} open={props.open}><DialogContent closeLabel="Close menu preview" size="wide"><DialogHeader><DialogTitle>Menu preview</DialogTitle><DialogDescription>This is a preview of the current draft. It does not change the public menu.</DialogDescription></DialogHeader><DialogBody><MenuPreviewContent categories={visibleCategories} draft={props.draft} productById={props.productById} selectedProductSet={props.selectedProductSet} /></DialogBody></DialogContent></Dialog.Root>;
}

function SmartMenuQrDialog({ open, onOpenChange, publicPath }: { open: boolean; onOpenChange: (open: boolean) => void; publicPath: string | null }) {
  const [qrSource, setQrSource] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !publicPath) return;
    let active = true;
    const publicUrl = new URL(publicPath, window.location.origin).toString();
    void QRCode.toDataURL(publicUrl, { errorCorrectionLevel: "M", margin: 1, width: 280 }).then((next) => {
      if (active) setQrSource(next);
    });
    return () => { active = false; };
  }, [open, publicPath]);

  return <Dialog.Root onOpenChange={onOpenChange} open={open}><DialogContent closeLabel="Close Smart Menu QR code"><DialogHeader><DialogTitle>Share Smart Menu</DialogTitle><DialogDescription>Customers can scan this QR code to open the published menu.</DialogDescription></DialogHeader><DialogBody className="space-y-4"><div className="grid place-items-center rounded-xl border bg-muted/20 p-5">{qrSource ? <Image alt="QR code for the published Smart Menu" className="size-60 max-w-full" height={240} src={qrSource} unoptimized width={240} /> : <LoaderCircle aria-label="Preparing QR code" className="size-6 animate-spin text-muted-foreground" />}</div><Input readOnly value={publicPath ?? ""} /></DialogBody><DialogFooter className="justify-end border-t px-4 py-4 sm:px-6"><Button onClick={() => onOpenChange(false)} type="button" variant="outline">Close</Button></DialogFooter></DialogContent></Dialog.Root>;
}

function EmptyCatalogMessage() {
  return <div className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground"><Settings2 className="mx-auto mb-2 size-5" aria-hidden="true" />Create active categories and products in Catalog before configuring this Smart Menu.</div>;
}
