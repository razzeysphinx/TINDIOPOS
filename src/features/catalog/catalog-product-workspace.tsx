"use client";

import { Menu } from "@base-ui/react/menu";
import { Archive, CircleHelp, EllipsisVertical, LoaderCircle, Package, Plus, Printer, RotateCcw, Search, SlidersHorizontal, Trash2, Warehouse } from "lucide-react";
import { useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/tooltip";
import { createProductComponentAction, createProductUnitAction, deleteCatalogProductAction, setProductArchivedAction, setProductStoreConfigurationAction, updateProductAction } from "@/features/catalog/actions";
import { CatalogCsvTools, CreateProductForm, ProductAvailabilityButton } from "@/features/catalog/catalog-forms";
import { printProductLabelDocument } from "@/features/catalog/catalog-label-print";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import type { CatalogActionResult, CatalogWorkspace } from "@/features/catalog/catalog-types";

type ProductWorkspaceProps = CatalogWorkspace & {
  canTrackInventory: boolean;
  canUseWeightedProducts: boolean;
  canViewCost: boolean;
  currencyCode: string;
  unitOptions: string[];
};

type DrawerTab = "overview" | "inventory" | "stores" | "units" | "components";

const selectClassName = "h-9 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const pageSize = 50;

function moneyInput(minor: number) {
  return (minor / 100).toFixed(2);
}

function productTypeLabel(productType: string, isComposite: boolean) {
  if (isComposite || productType === "composite") return "Composite";
  if (productType === "variable") return "Variants";
  return "Standard";
}

export function CatalogProductWorkspace(props: ProductWorkspaceProps) {
  const { categories, stores, products, variants, settings, costs, inventoryLevels, units, components, canTrackInventory, canUseWeightedProducts, canViewCost, currencyCode, unitOptions } = props;
  const activeStores = useMemo(() => stores.filter((store) => store.is_active), [stores]);
  const activeCategories = useMemo(() => categories.filter((category) => !category.is_archived), [categories]);
  const categoryNames = useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories]);
  const costByProduct = useMemo(() => new Map(costs.filter((cost) => !cost.variant_id).map((cost) => [cost.product_id, cost.cost_minor])), [costs]);
  const activeStoreIds = useMemo(() => new Set(activeStores.map((store) => store.id)), [activeStores]);
  const settingsByProduct = useMemo(() => {
    const index = new Map<string, CatalogWorkspace["settings"]>();
    for (const setting of settings) if (activeStoreIds.has(setting.store_id)) index.set(setting.product_id, [...(index.get(setting.product_id) ?? []), setting]);
    return index;
  }, [activeStoreIds, settings]);
  const inventoryByProduct = useMemo(() => {
    const index = new Map<string, CatalogWorkspace["inventoryLevels"]>();
    for (const level of inventoryLevels) index.set(level.product_id, [...(index.get(level.product_id) ?? []), level]);
    return index;
  }, [inventoryLevels]);
  const unitsByProduct = useMemo(() => {
    const index = new Map<string, CatalogWorkspace["units"]>();
    for (const unit of units) index.set(unit.product_id, [...(index.get(unit.product_id) ?? []), unit]);
    return index;
  }, [units]);
  const componentsByProduct = useMemo(() => {
    const index = new Map<string, CatalogWorkspace["components"]>();
    for (const component of components) index.set(component.product_id, [...(index.get(component.product_id) ?? []), component]);
    return index;
  }, [components]);
  const variantsByProduct = useMemo(() => {
    const index = new Map<string, CatalogWorkspace["variants"]>();
    for (const variant of variants) index.set(variant.product_id, [...(index.get(variant.product_id) ?? []), variant]);
    return index;
  }, [variants]);
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("active");
  const [productType, setProductType] = useState("");
  const [storeId, setStoreId] = useState("");
  const [sort, setSort] = useState("name-asc");
  const [page, setPage] = useState(1);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const lastFocusedProductId = useRef<string | null>(null);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const result = products.filter((product) => {
      const matchesSearch = !normalizedQuery || [product.name, product.sku, product.barcode].some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
      const matchesCategory = !categoryId || product.category_id === categoryId;
      const matchesStatus = status === "all" || product.status === status;
      const matchesType = !productType || productTypeLabel(product.product_type, product.is_composite).toLocaleLowerCase() === productType;
      const matchesStore = !storeId || (settingsByProduct.get(product.id) ?? []).some((setting) => setting.store_id === storeId && setting.is_available);
      return matchesSearch && matchesCategory && matchesStatus && matchesType && matchesStore;
    });
    return result.toSorted((a, b) => {
      if (sort === "name-desc") return b.name.localeCompare(a.name);
      if (sort === "price-asc") return a.price_minor - b.price_minor;
      if (sort === "price-desc") return b.price_minor - a.price_minor;
      if (sort === "recent") return b.created_at.localeCompare(a.created_at);
      return a.name.localeCompare(b.name);
    });
  }, [categoryId, productType, products, query, settingsByProduct, sort, status, storeId]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleProducts = filteredProducts.slice((safePage - 1) * pageSize, safePage * pageSize);
  const selectedProduct = products.find((product) => product.id === selectedProductId) ?? null;
  const filtersAreActive = Boolean(query || categoryId || productType || storeId || status !== "active");

  const chooseProduct = (productId: string) => {
    lastFocusedProductId.current = productId;
    setSelectedProductId(productId);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    const productId = lastFocusedProductId.current;
    if (productId) window.requestAnimationFrame(() => {
      const candidates = [document.getElementById(`catalog-product-${productId}`), document.getElementById(`catalog-product-mobile-${productId}`)];
      candidates.find((element) => element && element.getClientRects().length > 0)?.focus();
    });
  };

  const resetPage = () => setPage(1);
  const clearFilters = () => {
    setQuery("");
    setCategoryId("");
    setStatus("active");
    setProductType("");
    setStoreId("");
    setSort("name-asc");
    setPage(1);
  };

  return <>
    <section aria-label="Catalog filters" className="space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <label className="relative block min-w-0 flex-1 lg:max-w-xl">
          <span className="sr-only">Search products</span>
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" onChange={(event) => { setQuery(event.target.value); resetPage(); }} placeholder="Search products, SKU or barcode" type="search" value={query} />
        </label>
        <div className="flex flex-wrap gap-2">
          <CatalogCsvTools categories={activeCategories.map(({ id, name }) => ({ id, name }))} stores={activeStores.map(({ id, name }) => ({ id, name }))} />
          {activeStores.length ? <CreateProductForm canTrackInventory={canTrackInventory} canUseWeightedProducts={canUseWeightedProducts} canViewCost={canViewCost} categories={activeCategories.map(({ id, name }) => ({ id, name }))} stores={activeStores.map(({ id, name }) => ({ id, name }))} unitOptions={unitOptions} /> : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Category" className={selectClassName} onChange={(event) => { setCategoryId(event.target.value); resetPage(); }} value={categoryId}><option value="">All categories</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
        <select aria-label="Status" className={selectClassName} onChange={(event) => { setStatus(event.target.value); resetPage(); }} value={status}><option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option></select>
        <select aria-label="Product type" className={selectClassName} onChange={(event) => { setProductType(event.target.value); resetPage(); }} value={productType}><option value="">All product types</option><option value="standard">Standard</option><option value="variants">Variants</option><option value="composite">Composite</option></select>
        <select aria-label="Store" className={selectClassName} onChange={(event) => { setStoreId(event.target.value); resetPage(); }} value={storeId}><option value="">All stores</option>{activeStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><span>Sort</span><select aria-label="Sort products" className={selectClassName} onChange={(event) => { setSort(event.target.value); resetPage(); }} value={sort}><option value="name-asc">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="price-asc">Price low–high</option><option value="price-desc">Price high–low</option><option value="recent">Recently added</option></select></label>
      </div>
    </section>

    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div><CardTitle>Products</CardTitle><p aria-live="polite" className="mt-1 text-sm text-muted-foreground">{filteredProducts.length} product{filteredProducts.length === 1 ? "" : "s"}</p></div>
        <SlidersHorizontal aria-hidden="true" className="size-5 text-muted-foreground" />
      </CardHeader>
      <CardContent className="p-0">
        {visibleProducts.length ? <>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-190 text-left text-sm">
              <thead className="border-y bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-5 py-2.5 font-medium">Product</th><th className="px-3 py-2.5 font-medium">Category</th><th className="px-3 py-2.5 text-right font-medium">Price</th><th className="px-3 py-2.5 font-medium">Stock</th><th className="px-3 py-2.5 font-medium">Stores</th><th className="px-5 py-2.5 font-medium">Status</th></tr></thead>
              <tbody className="divide-y">{visibleProducts.map((product) => <ProductTableRow activeStoreCount={activeStores.length} categoryName={categoryNames.get(product.category_id ?? "") ?? "Uncategorized"} currencyCode={currencyCode} inventoryLevels={inventoryByProduct.get(product.id) ?? []} isSelected={drawerOpen && selectedProductId === product.id} key={product.id} onSelect={() => chooseProduct(product.id)} product={product} settings={settingsByProduct.get(product.id) ?? []} />)}</tbody>
            </table>
          </div>
          <div className="divide-y lg:hidden">{visibleProducts.map((product) => <ProductMobileRow activeStoreCount={activeStores.length} categoryName={categoryNames.get(product.category_id ?? "") ?? "Uncategorized"} currencyCode={currencyCode} inventoryLevels={inventoryByProduct.get(product.id) ?? []} isSelected={drawerOpen && selectedProductId === product.id} key={product.id} onSelect={() => chooseProduct(product.id)} product={product} settings={settingsByProduct.get(product.id) ?? []} />)}</div>
          {pageCount > 1 ? <div className="flex items-center justify-between gap-3 border-t px-5 py-3 text-sm"><span className="text-muted-foreground">Page {safePage} of {pageCount}</span><div className="flex gap-2"><Button disabled={safePage === 1} onClick={() => setPage((current) => Math.max(1, current - 1))} size="sm" type="button" variant="outline">Previous</Button><Button disabled={safePage === pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} size="sm" type="button" variant="outline">Next</Button></div></div> : null}
        </> : <div className="px-5 py-12 text-center"><Package aria-hidden="true" className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">{products.length === 0 ? "No products yet." : status === "archived" && !query && !categoryId && !productType && !storeId ? "No archived products." : "No products found."}</p><p className="mt-1 text-sm text-muted-foreground">{products.length === 0 ? "Add your first product to start building your catalog." : "Clear the search or choose broader filters."}</p>{filtersAreActive ? <Button className="mt-4" onClick={clearFilters} type="button" variant="outline">Clear filters</Button> : null}</div>}
      </CardContent>
    </Card>

    <Dialog.Root modal={false} onOpenChange={(open) => { if (!open) closeDrawer(); }} open={drawerOpen}>
      <DialogContent className="flex h-dvh max-h-none max-w-none flex-col rounded-none sm:max-w-[40rem]" closeLabel="Close product details" nonBlocking side="right">
        {selectedProduct ? <ProductDrawer activeCategories={activeCategories} activeStores={activeStores} allProducts={products} canTrackInventory={canTrackInventory} canUseWeightedProducts={canUseWeightedProducts} canViewCost={canViewCost} components={componentsByProduct.get(selectedProduct.id) ?? []} costMinor={costByProduct.get(selectedProduct.id) ?? 0} currencyCode={currencyCode} inventoryLevels={inventoryByProduct.get(selectedProduct.id) ?? []} key={selectedProduct.id} product={selectedProduct} settings={settingsByProduct.get(selectedProduct.id) ?? []} units={unitsByProduct.get(selectedProduct.id) ?? []} variants={variantsByProduct.get(selectedProduct.id) ?? []} /> : null}
      </DialogContent>
    </Dialog.Root>
  </>;
}

type ListRowProps = {
  activeStoreCount: number;
  categoryName: string;
  currencyCode: string;
  inventoryLevels: CatalogWorkspace["inventoryLevels"];
  isSelected: boolean;
  onSelect: () => void;
  product: CatalogWorkspace["products"][number];
  settings: CatalogWorkspace["settings"];
};

function stockStatus(product: ListRowProps["product"], levels: ListRowProps["inventoryLevels"], settings: ListRowProps["settings"]) {
  if (!product.track_inventory) return { label: "Not tracked", tone: "text-muted-foreground" };
  const total = levels.reduce((sum, level) => sum + Number(level.quantity), 0);
  if (levels.some((level) => Number(level.quantity) < 0)) return { label: `${total} · Negative`, tone: "text-destructive" };
  if (total <= 0) return { label: "0 · Out", tone: "text-destructive" };
  const low = levels.some((level) => { const threshold = settings.find((setting) => setting.store_id === level.store_id)?.low_stock_level; return threshold !== null && threshold !== undefined && Number(level.quantity) <= Number(threshold); });
  return { label: low ? `${total} · Low` : String(total), tone: low ? "text-amber-700 dark:text-amber-400" : "text-foreground" };
}

function ProductTableRow({ activeStoreCount, categoryName, currencyCode, inventoryLevels, isSelected, onSelect, product, settings }: ListRowProps) {
  const stock = stockStatus(product, inventoryLevels, settings);
  const availableStores = settings.filter((setting) => setting.is_available).length;
  return <tr aria-label={`Open ${product.name}`} aria-pressed={isSelected} className={`cursor-pointer transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 ${isSelected ? "bg-primary/10 hover:bg-primary/10" : ""}`} id={`catalog-product-${product.id}`} onClick={onSelect} onKeyDown={(event) => { if (event.currentTarget !== event.target || (event.key !== "Enter" && event.key !== " ")) return; event.preventDefault(); onSelect(); }} role="button" tabIndex={0}>
    <td className="px-5 py-3"><div className="flex min-w-0 items-center gap-3">{product.image_url ? <span aria-hidden="true" className="size-10 shrink-0 rounded-lg border bg-cover bg-center" style={{ backgroundImage: `url(${product.image_url})` }} /> : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Package aria-hidden="true" className="size-4" /></span>}<span className="min-w-0"><span className="block truncate font-semibold">{product.name}</span><span className="block truncate text-xs text-muted-foreground">{product.sku || product.barcode || productTypeLabel(product.product_type, product.is_composite)}</span></span></div></td>
    <td className="px-3 py-3 text-muted-foreground">{categoryName}</td><td className="px-3 py-3 text-right font-medium tabular-nums">{product.product_type === "variable" ? "Varies" : formatMinorMoney(product.price_minor, currencyCode)}</td><td className={`px-3 py-3 font-medium ${stock.tone}`}>{stock.label}</td><td className="px-3 py-3 text-muted-foreground">{availableStores} / {activeStoreCount}</td><td className="px-5 py-3"><Badge variant={product.status === "archived" ? "outline" : "secondary"}>{product.status === "archived" ? "Archived" : "Active"}</Badge></td>
  </tr>;
}

function ProductMobileRow(props: ListRowProps) {
  const { activeStoreCount, categoryName, currencyCode, inventoryLevels, isSelected, onSelect, product, settings } = props;
  const stock = stockStatus(product, inventoryLevels, settings);
  const availableStores = settings.filter((setting) => setting.is_available).length;
  return <button aria-pressed={isSelected} className={`w-full px-4 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 ${isSelected ? "bg-primary/10" : ""}`} id={`catalog-product-mobile-${product.id}`} onClick={onSelect} type="button"><span className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block truncate font-semibold">{product.name}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{categoryName} · {productTypeLabel(product.product_type, product.is_composite)}</span></span><Badge variant={product.status === "archived" ? "outline" : "secondary"}>{product.status === "archived" ? "Archived" : "Active"}</Badge></span><span className="mt-3 grid grid-cols-3 gap-2 text-xs text-muted-foreground"><span>Price<strong className="block truncate text-foreground">{product.product_type === "variable" ? "Varies" : formatMinorMoney(product.price_minor, currencyCode)}</strong></span><span>Stock<strong className={`block ${stock.tone}`}>{stock.label}</strong></span><span>Stores<strong className="block text-foreground">{availableStores} / {activeStoreCount}</strong></span></span></button>;
}

type ProductDrawerProps = {
  activeCategories: CatalogWorkspace["categories"];
  activeStores: CatalogWorkspace["stores"];
  allProducts: CatalogWorkspace["products"];
  canTrackInventory: boolean;
  canUseWeightedProducts: boolean;
  canViewCost: boolean;
  components: CatalogWorkspace["components"];
  costMinor: number;
  currencyCode: string;
  inventoryLevels: CatalogWorkspace["inventoryLevels"];
  product: CatalogWorkspace["products"][number];
  settings: CatalogWorkspace["settings"];
  units: CatalogWorkspace["units"];
  variants: CatalogWorkspace["variants"];
};

function ProductDrawer(props: ProductDrawerProps) {
  const { product, activeCategories, units } = props;
  const [tab, setTab] = useState<DrawerTab>("overview");
  const tabs: Array<{ id: DrawerTab; label: string }> = [{ id: "overview", label: "Overview" }];
  if (props.canTrackInventory && product.track_inventory) tabs.push({ id: "inventory", label: "Inventory" });
  tabs.push({ id: "stores", label: "Stores" });
  if (units.length > 1 || tab === "units") tabs.push({ id: "units", label: "Units" });
  if (product.is_composite || product.product_type === "composite") tabs.push({ id: "components", label: "Components" });
  const categoryName = activeCategories.find((category) => category.id === product.category_id)?.name ?? "Uncategorized";

  return <>
    <DialogHeader className="sticky top-0 z-10 shrink-0 bg-background pr-20 sm:pr-24">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><DialogTitle className="truncate">{product.name}</DialogTitle><Badge variant={product.status === "archived" ? "outline" : "secondary"}>{product.status === "archived" ? "Archived" : "Active"}</Badge></div><DialogDescription><span className="block text-xs font-medium tracking-wide uppercase">Category</span>{categoryName}</DialogDescription></div><Menu.Root modal={false}><Menu.Trigger aria-label="Product actions" className="grid size-9 shrink-0 place-items-center rounded-lg border bg-background text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"><EllipsisVertical aria-hidden="true" className="size-4" /></Menu.Trigger><Menu.Portal><Menu.Positioner align="end" className="z-[70]" side="bottom" sideOffset={6}><Menu.Popup className="w-52 rounded-lg border bg-popover p-1 shadow-lg outline-none"><ProductActionMenuItems currencyCode={props.currencyCode} product={product} /></Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root></div>
      <div aria-label="Product sections" className="-mb-4 mt-4 flex gap-1 overflow-x-auto" role="tablist">{tabs.map((item) => <button aria-selected={tab === item.id} className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} key={item.id} onClick={() => setTab(item.id)} role="tab" type="button">{item.label}</button>)}</div>
    </DialogHeader>
    <DialogBody className="min-h-0 max-h-none flex-1">
      {tab === "overview" ? <ProductOverview {...props} onOpenUnits={() => setTab("units")} /> : null}
      {tab === "inventory" ? <ProductInventory {...props} /> : null}
      {tab === "stores" ? <ProductStores {...props} /> : null}
      {tab === "units" ? <ProductUnits {...props} /> : null}
      {tab === "components" ? <ProductComponents {...props} /> : null}
    </DialogBody>
  </>;
}

function ProductActionMenuItems({ currencyCode, product }: { currencyCode: string; product: ProductDrawerProps["product"] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const menuItemClassName = "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-highlighted:bg-muted disabled:pointer-events-none disabled:opacity-50";
  return <>{product.product_type !== "variable" ? <Menu.Item className={menuItemClassName} disabled={!product.barcode} onClick={() => printProductLabelDocument({ barcode: product.barcode, price: formatMinorMoney(product.price_minor, currencyCode), productName: product.name, sku: product.sku })}><Printer aria-hidden="true" className="size-4" />Print label</Menu.Item> : null}<Menu.Item className={menuItemClassName} disabled={isPending} onClick={() => startTransition(async () => { const result = await setProductArchivedAction({ productId: product.id, isArchived: product.status !== "archived" }); if (result.ok) router.refresh(); })}>{isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : product.status === "archived" ? <RotateCcw aria-hidden="true" className="size-4" /> : <Archive aria-hidden="true" className="size-4" />}{product.status === "archived" ? "Restore" : "Archive"}</Menu.Item></>;
}

function ResultMessage({ result }: { result: CatalogActionResult<unknown> | null }) {
  return result ? <p aria-live="polite" className={`text-sm ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>{result.message}</p> : null;
}

function ProductOverview(props: ProductDrawerProps & { onOpenUnits: () => void }) {
  const { product, activeCategories, canTrackInventory, canUseWeightedProducts, canViewCost, costMinor } = props;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setResult(null);
    startTransition(async () => {
      const next = await updateProductAction({ productId: product.id, name: form.get("name"), description: form.get("description"), categoryId: form.get("categoryId"), sku: form.get("sku"), barcode: form.get("barcode"), price: form.get("price"), cost: canViewCost && product.product_type !== "variable" ? form.get("cost") : moneyInput(costMinor), trackInventory: product.is_composite ? product.track_inventory : form.get("trackInventory") === "on", imageUrl: form.get("imageUrl"), isVariablePrice: form.get("isVariablePrice") === "on", allowFractionalQuantity: form.get("allowFractionalQuantity") === "on", unit: product.unit });
      setResult(next);
      if (next.ok) router.refresh();
    });
  };
  return <form className="space-y-5" onSubmit={submit}><section className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Product name<Input defaultValue={product.name} name="name" required /></label><label className="grid gap-1.5 text-sm font-medium">Category<select className={selectClassName} defaultValue={product.category_id ?? ""} name="categoryId"><option value="">Uncategorized</option>{activeCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{product.product_type !== "variable" ? <label className="grid gap-1.5 text-sm font-medium">Selling price<Input defaultValue={moneyInput(product.price_minor)} inputMode="decimal" name="price" required /></label> : <input name="price" type="hidden" value={moneyInput(product.price_minor)} />}{canViewCost && product.product_type !== "variable" ? <label className="grid gap-1.5 text-sm font-medium">Cost<Input defaultValue={moneyInput(costMinor)} inputMode="decimal" name="cost" required /></label> : null}{product.product_type !== "variable" ? <><label className="grid gap-1.5 text-sm font-medium">SKU<Input defaultValue={product.sku ?? ""} name="sku" /></label><label className="grid gap-1.5 text-sm font-medium">Barcode<Input defaultValue={product.barcode ?? ""} name="barcode" /></label></> : <><input name="sku" type="hidden" value="" /><input name="barcode" type="hidden" value="" /></>}<label className="grid gap-1.5 text-sm font-medium sm:col-span-2">Description<Input defaultValue={product.description ?? ""} name="description" /></label></section>{product.product_type === "variable" ? <section className="rounded-xl border p-4"><h3 className="font-semibold">Variants</h3><div className="mt-2 divide-y">{props.variants.map((variant) => <div className="flex items-center justify-between gap-3 py-2 text-sm" key={variant.id}><span><span className="block font-medium">{variant.name}</span><span className="text-xs text-muted-foreground">{variant.sku || variant.barcode || "No identifier"}</span></span><strong>{formatMinorMoney(variant.price_minor, props.currencyCode)}</strong></div>)}</div></section> : null}<div className="flex flex-wrap gap-3"><Label className="flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2"><input defaultChecked={product.track_inventory} disabled={!canTrackInventory || product.is_composite} name="trackInventory" type="checkbox" />Track inventory</Label>{product.product_type !== "variable" ? <Label className="flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2"><input defaultChecked={product.is_variable_price} name="isVariablePrice" type="checkbox" />Enter price at sale</Label> : null}<Label className="flex min-h-9 items-center gap-2 rounded-lg border px-3 py-2"><input defaultChecked={product.allow_fractional_quantity} disabled={!canUseWeightedProducts} name="allowFractionalQuantity" type="checkbox" />Allow fractional quantity</Label></div><details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">Advanced details</summary><div className="mt-4 space-y-4"><label className="grid gap-1.5 text-sm font-medium">Image URL<Input defaultValue={product.image_url ?? ""} name="imageUrl" placeholder="https://…/product.jpg" /></label>{props.units.length <= 1 ? <div className="rounded-lg bg-muted/40 p-3"><p className="font-medium">Selling & purchasing units</p><p className="mt-1 text-sm text-muted-foreground">Use this when you buy or sell the same product by piece, pack, case, kilo, or another unit.</p><Button className="mt-3" onClick={props.onOpenUnits} size="sm" type="button" variant="outline">Manage units</Button></div> : null}</div></details><div className="flex flex-wrap items-center gap-3"><Button disabled={isPending} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : null}Save changes</Button>{product.status === "archived" ? <DeleteProductControl productId={product.id} productName={product.name} /> : null}</div><ResultMessage result={result} /></form>;
}

function DeleteProductControl({ productId, productName }: { productId: string; productName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  return <Dialog.Root onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) { setConfirmationName(""); setResult(null); } }} open={open}><button className="inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium text-destructive outline-none hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-ring/50" onClick={() => setOpen(true)} type="button"><Trash2 aria-hidden="true" className="size-4" />Delete permanently</button><DialogContent><DialogHeader><DialogTitle>Delete {productName} permanently?</DialogTitle><DialogDescription>This is only allowed when the archived product has no stock, sales, inventory, purchasing, transfer, component, or audit history. Otherwise, keep it archived.</DialogDescription></DialogHeader><DialogBody className="space-y-4"><label className="grid gap-1.5 text-sm font-medium">Type <strong>{productName}</strong> to confirm<Input autoFocus onChange={(event) => setConfirmationName(event.target.value)} value={confirmationName} /></label><ResultMessage result={result} /><div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)} type="button" variant="outline">Cancel</Button><Button disabled={isPending || confirmationName !== productName} onClick={() => startTransition(async () => { const next = await deleteCatalogProductAction({ productId, confirmationName }); setResult(next); if (next.ok) { setOpen(false); router.refresh(); } })} type="button" variant="destructive">{isPending ? <LoaderCircle className="animate-spin" /> : <Trash2 />}Delete permanently</Button></div></DialogBody></DialogContent></Dialog.Root>;
}

function ProductInventory(props: ProductDrawerProps) {
  const stock = stockStatus(props.product, props.inventoryLevels, props.settings);
  const total = props.inventoryLevels.reduce((sum, level) => sum + Number(level.quantity), 0);
  return <section className="space-y-5"><div><h3 className="font-semibold">Inventory summary</h3><p className="mt-1 text-sm text-muted-foreground">A light product snapshot. Movement history and stock actions stay in Inventory.</p></div><div className="divide-y rounded-xl border px-4"><SummaryRow label="Tracked" value={props.product.track_inventory ? "Yes" : "No"} /><SummaryRow label="Total available" value={String(total)} /><SummaryRow label="Status" value={stock.label.includes("·") ? stock.label.split("·").at(-1)?.trim() ?? stock.label : stock.label} /></div><Button nativeButton={false} render={<a href={`/back-office/inventory?search=${encodeURIComponent(props.product.name)}`} />} variant="outline"><Warehouse aria-hidden="true" />View in Inventory</Button></section>;
}

function ProductStores(props: ProductDrawerProps) {
  return <section className="space-y-4"><div><ConceptHeading help="A store can use the organization price or a different price, and can have its own low-stock alert." label="Store settings" /><p className="mt-1 text-sm text-muted-foreground">Set store availability, store-specific price, and low-stock alert levels.</p></div>{props.activeStores.map((store) => <StoreSettings key={store.id} product={props.product} currencyCode={props.currencyCode} setting={props.settings.find((setting) => setting.store_id === store.id)} store={store} />)}</section>;
}

function StoreSettings({ currencyCode, product, setting, store }: { currencyCode: string; product: ProductDrawerProps["product"]; setting: ProductDrawerProps["settings"][number] | undefined; store: ProductDrawerProps["activeStores"][number] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); setResult(null); startTransition(async () => { const next = await setProductStoreConfigurationAction({ productId: product.id, storeId: store.id, priceOverride: form.get("priceOverride"), lowStockLevel: form.get("lowStockLevel") }); setResult(next); if (next.ok) router.refresh(); }); };
  return <form className="rounded-xl border p-4" onSubmit={submit}><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="font-semibold">{store.name}</h4><p className="text-xs text-muted-foreground">Default selling price: {formatMinorMoney(product.price_minor, currencyCode)}</p></div><ProductAvailabilityButton isAvailable={setting?.is_available ?? false} productId={product.id} storeId={store.id} storeName={store.name} /></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Override price<Input defaultValue={setting?.price_override_minor == null ? "" : moneyInput(setting.price_override_minor)} inputMode="decimal" name="priceOverride" placeholder="Use organization default" /></label><label className="grid gap-1.5 text-sm font-medium">Low-stock alert<Input defaultValue={setting?.low_stock_level ?? ""} inputMode="decimal" name="lowStockLevel" placeholder="Optional" /></label></div><div className="mt-3 flex flex-wrap items-center gap-3"><Button disabled={isPending} size="sm" type="submit" variant="outline">{isPending ? <LoaderCircle className="animate-spin" /> : null}Save store settings</Button><ResultMessage result={result} /></div></form>;
}

function ProductUnits(props: ProductDrawerProps) {
  const router = useRouter(); const [isPending, startTransition] = useTransition(); const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null);
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); const unitName = String(form.get("unitName") ?? ""); const explicitCode = String(form.get("unitCode") ?? "").trim(); const generatedCode = unitName.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24); startTransition(async () => { const next = await createProductUnitAction({ productId: props.product.id, unitCode: explicitCode || generatedCode, unitName, factorToBase: form.get("factorToBase"), isSaleUnit: form.get("isSaleUnit") === "on", isPurchaseUnit: form.get("isPurchaseUnit") === "on" }); setResult(next); if (next.ok) { (event.currentTarget as HTMLFormElement).reset(); router.refresh(); } }); };
  return <section className="space-y-5"><div><ConceptHeading help="Add a unit when you buy or sell this item in a different quantity, such as a case containing 24 each." label="Selling & purchasing units" /><p className="mt-1 text-sm text-muted-foreground">Use this when you buy or sell the same product by piece, pack, case, kilo, or another unit.</p></div><div className="divide-y rounded-xl border px-4">{props.units.map((unit) => <div className="flex items-start justify-between gap-3 py-3" key={unit.id}><div><p className="font-medium">{unit.unit_name}{unit.is_base ? " · Base unit" : ""}</p><p className="mt-1 text-xs text-muted-foreground">1 {unit.unit_name} contains {unit.factor_to_base} {props.product.unit}{Number(unit.factor_to_base) === 1 ? "" : "s"}</p></div><span className="text-right text-xs text-muted-foreground">{[unit.is_sale_unit ? "Selling" : "", unit.is_purchase_unit ? "Purchasing" : ""].filter(Boolean).join(" · ")}</span></div>)}</div><form className="space-y-4 rounded-xl border p-4" onSubmit={submit}><h4 className="font-semibold">Add another unit</h4><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Unit name<Input name="unitName" placeholder="Case" required /></label><label className="grid gap-1.5 text-sm font-medium">Contains<Input inputMode="decimal" name="factorToBase" placeholder={`24 ${props.product.unit}`} required /></label></div><div className="flex flex-wrap gap-3"><Label className="flex items-center gap-2"><input defaultChecked name="isPurchaseUnit" type="checkbox" />Purchasing</Label><Label className="flex items-center gap-2"><input name="isSaleUnit" type="checkbox" />Selling</Label></div><details><summary className="cursor-pointer text-sm font-medium">Advanced unit details</summary><label className="mt-3 grid gap-1.5 text-sm font-medium">Unit code<Input maxLength={24} name="unitCode" placeholder="Generated from unit name" /></label></details><Button disabled={isPending} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}Add unit</Button><ResultMessage result={result} /></form></section>;
}

function ProductComponents(props: ProductDrawerProps) {
  const router = useRouter(); const [isPending, startTransition] = useTransition(); const [result, setResult] = useState<CatalogActionResult<unknown> | null>(null); const candidates = props.allProducts.filter((candidate) => candidate.id !== props.product.id && candidate.product_type !== "variable" && candidate.status === "active");
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); startTransition(async () => { const next = await createProductComponentAction({ productId: props.product.id, componentProductId: form.get("componentProductId"), componentVariantId: "", quantityPerComposite: form.get("quantityPerComposite") }); setResult(next); if (next.ok) { (event.currentTarget as HTMLFormElement).reset(); router.refresh(); } }); };
  return <section className="space-y-5"><div><ConceptHeading help="Components are the stock items deducted automatically whenever this composite product is sold." label="Components / Recipe" /><p className="mt-1 text-sm text-muted-foreground">Choose the items deducted from inventory whenever this product is sold.</p></div><div className="divide-y rounded-xl border px-4">{props.components.length ? props.components.map((component) => { const item = props.allProducts.find((product) => product.id === component.component_product_id); return <div className="flex justify-between gap-3 py-3" key={component.id}><span className="font-medium">{item?.name ?? "Component"}</span><span className="tabular-nums text-muted-foreground">{component.quantity_per_composite} {item?.unit ?? "units"}</span></div>; }) : <p className="py-4 text-sm text-muted-foreground">No components added yet.</p>}</div><form className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[1fr_8rem_auto] sm:items-end" onSubmit={submit}><label className="grid gap-1.5 text-sm font-medium">Component<select className={selectClassName} name="componentProductId" required><option value="">Choose a product</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">Quantity<Input inputMode="decimal" name="quantityPerComposite" required /></label><Button disabled={isPending} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}Add</Button></form><ResultMessage result={result} /></section>;
}

function ConceptHeading({ help, label }: { help: string; label: string }) {
  return <h3 className="flex items-center gap-2 font-semibold">{label}<Tooltip content={help}><button aria-label={`About ${label}`} className="rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50" type="button"><CircleHelp aria-hidden="true" className="size-4" /></button></Tooltip></h3>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 py-3 text-sm"><span className="text-muted-foreground">{label}</span><strong className="text-right">{value}</strong></div>;
}
