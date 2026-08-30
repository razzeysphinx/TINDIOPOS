"use client";

import { Grid2X2, List, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  getInventoryStockCondition,
  inventoryStockConditionLabels,
  type InventoryStockCondition,
} from "@/features/inventory/inventory-stock-status";

export type InventoryStockRow = {
  averageCostMinor: number | null;
  barcode: string | null;
  categoryId: string | null;
  categoryName: string | null;
  detailHref: string;
  id: string;
  isAvailable: boolean;
  productId: string;
  productName: string;
  quantity: number;
  reorderPoint: number | null;
  sku: string | null;
  storeId: string;
  storeName: string;
  unit: string;
  updatedAt: string;
  variantId: string | null;
  variantName: string | null;
};

type InventoryStockViewProps = {
  canUseReorderStatus: boolean;
  canViewCosts: boolean;
  currencyCode: string;
  initialStatus?: InventoryStockStatus;
  multiStoreCount: number;
  preferenceScope: string;
  rows: InventoryStockRow[];
};

export type InventoryStockStatus =
  | "all"
  | "attention"
  | "available"
  | "in_stock"
  | "low"
  | "negative"
  | "out_of_stock";

type InventoryStockLayout = "grid" | "list";
type InventoryStockSort = "name_asc" | "name_desc" | "quantity_asc" | "quantity_desc" | "updated_desc" | "value_desc";
type InventoryStockGroup = "none" | "category" | "status" | "store";
type InventoryStockRollup = {
  availableStoreCount: number;
  id: string;
  rows: InventoryStockRow[];
  totalQuantity: number;
  updatedAt: string;
};

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const stockStatusLabels: Record<Exclude<InventoryStockStatus, "all">, string> = {
  attention: "Needs attention",
  available: "Available to sell",
  in_stock: "In stock",
  low: "Low stock",
  negative: "Negative stock",
  out_of_stock: "Out of stock",
};

function stockCondition(row: InventoryStockRow): InventoryStockCondition {
  return getInventoryStockCondition({ quantity: row.quantity, reorderPoint: row.reorderPoint });
}

function matchesStatus(row: InventoryStockRow, status: InventoryStockStatus) {
  if (status === "all") return true;
  if (status === "available") return row.isAvailable;
  const condition = stockCondition(row);
  if (status === "attention") return condition === "low" || condition === "negative" || condition === "out_of_stock";
  return condition === status;
}

function statusVariant(status: ReturnType<typeof stockCondition>) {
  if (status === "negative") return "destructive" as const;
  if (status === "out_of_stock") return "outline" as const;
  if (status === "low") return "outline" as const;
  return "secondary" as const;
}

function rowLabel(row: InventoryStockRow) {
  return row.variantName ? `${row.productName} / ${row.variantName}` : row.productName;
}

function stockRowMatchesQuery(row: InventoryStockRow, query: string) {
  return !query || [row.productName, row.variantName, row.sku, row.barcode]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(query));
}

function stockRowMatchesCategory(row: InventoryStockRow, categoryId: string) {
  return categoryId === "all" || (row.categoryId ?? "uncategorized") === categoryId;
}

function buildStockRollups(rows: InventoryStockRow[]): InventoryStockRollup[] {
  const rollups = new Map<string, InventoryStockRollup>();

  for (const row of rows) {
    const id = `${row.productId}:${row.variantId ?? "base"}`;
    const existing = rollups.get(id);

    if (existing) {
      existing.rows.push(row);
      existing.totalQuantity += row.quantity;
      existing.availableStoreCount += row.isAvailable ? 1 : 0;
      if (new Date(row.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) existing.updatedAt = row.updatedAt;
    } else {
      rollups.set(id, {
        availableStoreCount: row.isAvailable ? 1 : 0,
        id,
        rows: [row],
        totalQuantity: row.quantity,
        updatedAt: row.updatedAt,
      });
    }
  }

  return Array.from(rollups.values());
}

function matchesRollupStatus(rollup: InventoryStockRollup, status: InventoryStockStatus) {
  return rollup.rows.some((row) => matchesStatus(row, status));
}

function rollupLabel(rollup: InventoryStockRollup) {
  return rowLabel(rollup.rows[0]);
}

function stockValue(row: InventoryStockRow) {
  return (row.averageCostMinor ?? 0) * row.quantity;
}

function sortRollups(rows: InventoryStockRollup[], sort: InventoryStockSort) {
  return [...rows].sort((left, right) => {
    switch (sort) {
      case "name_desc":
        return rollupLabel(right).localeCompare(rollupLabel(left));
      case "quantity_asc":
        return left.totalQuantity - right.totalQuantity || rollupLabel(left).localeCompare(rollupLabel(right));
      case "quantity_desc":
        return right.totalQuantity - left.totalQuantity || rollupLabel(left).localeCompare(rollupLabel(right));
      case "updated_desc":
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || rollupLabel(left).localeCompare(rollupLabel(right));
      case "value_desc":
        return right.rows.reduce((total, row) => total + stockValue(row), 0) - left.rows.reduce((total, row) => total + stockValue(row), 0) || rollupLabel(left).localeCompare(rollupLabel(right));
      default:
        return rollupLabel(left).localeCompare(rollupLabel(right));
    }
  });
}

function localStorageKey(scope: string) {
  return `tindio-inventory-stock-layout:${scope}`;
}

function readSavedLayout(scope: string): InventoryStockLayout {
  try {
    const savedLayout = window.localStorage.getItem(localStorageKey(scope));
    return savedLayout === "grid" || savedLayout === "list" ? savedLayout : "list";
  } catch {
    return "list";
  }
}

function subscribeToLayoutPreference() {
  return () => {};
}

export function InventoryStockView({
  canUseReorderStatus,
  canViewCosts,
  currencyCode,
  initialStatus = "all",
  multiStoreCount,
  preferenceScope,
  rows,
}: InventoryStockViewProps) {
  const savedLayout = useSyncExternalStore<InventoryStockLayout>(
    subscribeToLayoutPreference,
    () => readSavedLayout(preferenceScope),
    () => "list",
  );
  const [sessionLayout, setSessionLayout] = useState<InventoryStockLayout | null>(null);
  const layout = sessionLayout ?? savedLayout;
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const [status, setStatus] = useState<InventoryStockStatus>(initialStatus);
  const [sort, setSort] = useState<InventoryStockSort>("name_asc");
  const [group, setGroup] = useState<InventoryStockGroup>("none");

  const categories = useMemo(
    () => Array.from(
      new Map(
        rows.map((row) => [row.categoryId ?? "uncategorized", row.categoryName ?? "Uncategorized"]),
      ).entries(),
    )
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();

    return rows.filter((row) => {
      return stockRowMatchesQuery(row, query) && stockRowMatchesCategory(row, categoryId) && matchesStatus(row, status);
    });
  }, [categoryId, rows, search, status]);

  const multiStoreRollups = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const matchingRollups = buildStockRollups(rows).filter((rollup) => (
      rollup.rows.some((row) => stockRowMatchesQuery(row, query) && stockRowMatchesCategory(row, categoryId))
      && matchesRollupStatus(rollup, status)
    ));

    return sortRollups(matchingRollups, sort);
  }, [categoryId, rows, search, sort, status]);

  const sortedRows = useMemo(() => [...filteredRows].sort((left, right) => {
    switch (sort) {
      case "name_desc":
        return rowLabel(right).localeCompare(rowLabel(left));
      case "quantity_asc":
        return left.quantity - right.quantity || rowLabel(left).localeCompare(rowLabel(right));
      case "quantity_desc":
        return right.quantity - left.quantity || rowLabel(left).localeCompare(rowLabel(right));
      case "updated_desc":
        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime() || rowLabel(left).localeCompare(rowLabel(right));
      case "value_desc":
        return (right.averageCostMinor ?? 0) * right.quantity - (left.averageCostMinor ?? 0) * left.quantity || rowLabel(left).localeCompare(rowLabel(right));
      default:
        return rowLabel(left).localeCompare(rowLabel(right));
    }
  }), [filteredRows, sort]);

  const groups = useMemo(() => {
    const result = new Map<string, { id: string; label: string; rows: InventoryStockRow[] }>();

    for (const row of sortedRows) {
      const condition = stockCondition(row);
      const value = group === "category"
        ? { id: `category:${row.categoryId ?? "uncategorized"}`, label: row.categoryName ?? "Uncategorized" }
        : group === "store"
          ? { id: `store:${row.storeId}`, label: row.storeName }
          : group === "status"
            ? { id: `status:${condition}`, label: inventoryStockConditionLabels[condition] }
            : { id: "all", label: "All stock" };
      const existing = result.get(value.id);
      if (existing) existing.rows.push(row);
      else result.set(value.id, { ...value, rows: [row] });
    }

    return Array.from(result.values());
  }, [group, sortedRows]);

  const hasClientFilters = search.length > 0 || categoryId !== "all" || status !== "all" || sort !== "name_asc" || group !== "none";
  const updateLayout = (nextLayout: InventoryStockLayout) => {
    setSessionLayout(nextLayout);
    try {
      window.localStorage.setItem(localStorageKey(preferenceScope), nextLayout);
    } catch {
      // Keep the current-session preference when storage is unavailable.
    }
  };
  const clearClientFilters = () => {
    setSearch("");
    setCategoryId("all");
    setStatus("all");
    setSort("name_asc");
    setGroup("none");
  };

  return (
    <section className="space-y-4" aria-labelledby="stock-levels-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold" id="stock-levels-title">{multiStoreCount > 1 ? "Store records" : "Current stock"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{multiStoreCount > 1 ? "Individual projected balances remain store-specific. Use the page filter above to change the store scope." : "One projected balance per store and saleable item. Use the page filter above to change the store scope."}</p>
        </div>
        <div className="flex items-center gap-1 self-start rounded-lg border bg-muted/30 p-1 sm:self-auto" aria-label="Stock layout">
          <Button aria-label="List view" aria-pressed={layout === "list"} onClick={() => updateLayout("list")} size="icon-sm" type="button" variant={layout === "list" ? "secondary" : "ghost"}>
            <List aria-hidden="true" />
          </Button>
          <Button aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => updateLayout("grid")} size="icon-sm" type="button" variant={layout === "grid" ? "secondary" : "ghost"}>
            <Grid2X2 aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-3 sm:p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(15rem,1.5fr)_repeat(4,minmax(0,1fr))_auto]">
          <label className="grid gap-1.5 sm:col-span-2 xl:col-span-1">
            <span className="text-sm font-medium">Search</span>
            <span className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Search product, SKU, or barcode" className="pl-8" onChange={(event) => setSearch(event.target.value)} placeholder="Product, SKU, or barcode" type="search" value={search} />
            </span>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Category</span>
            <select className={selectClassName} onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
              <option value="all">All categories</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Status</span>
            <select className={selectClassName} onChange={(event) => setStatus(event.target.value as InventoryStockStatus)} value={status}>
              <option value="all">All statuses</option>
              <option value="in_stock">In stock</option>
              {canUseReorderStatus ? <option value="low">Low stock</option> : null}
              <option value="out_of_stock">Out of stock</option>
              <option value="negative">Negative stock</option>
              <option value="available">Available to sell</option>
              {canUseReorderStatus ? <option value="attention">Needs attention</option> : null}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Sort</span>
            <select className={selectClassName} onChange={(event) => setSort(event.target.value as InventoryStockSort)} value={sort}>
              <option value="name_asc">Name A–Z</option>
              <option value="name_desc">Name Z–A</option>
              <option value="quantity_desc">Quantity high–low</option>
              <option value="quantity_asc">Quantity low–high</option>
              <option value="updated_desc">Recently updated</option>
              {canViewCosts ? <option value="value_desc">Stock value high–low</option> : null}
            </select>
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Group</span>
            <select className={selectClassName} onChange={(event) => setGroup(event.target.value as InventoryStockGroup)} value={group}>
              <option value="none">No grouping</option>
              <option value="category">Category</option>
              <option value="store">Store</option>
              <option value="status">Stock status</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button disabled={!hasClientFilters} onClick={clearClientFilters} type="button" variant="outline">Clear</Button>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          <span>{filteredRows.length} of {rows.length} stock record{rows.length === 1 ? "" : "s"}</span>
          {!canUseReorderStatus ? <span>Low-stock status requires inventory management access.</span> : null}
        </div>
      </div>

      {multiStoreCount > 1 ? <MultiStoreStockSummary rollups={multiStoreRollups} storeCount={multiStoreCount} /> : null}

      {rows.length === 0 ? (
        <StockEmptyState title="No stock levels yet" description="Inventory levels appear when a tracked product is assigned to a store." />
      ) : groups.length === 0 ? (
        <StockEmptyState title="No stock matches these filters" description="Clear one or more filters to see available stock levels." />
      ) : (
        <div className="space-y-6">
          {groups.map((entry) => (
            <section aria-labelledby={`stock-group-${entry.id}`} className="space-y-3" key={entry.id}>
              {group !== "none" ? <div className="flex items-center justify-between gap-3"><h3 className="font-medium" id={`stock-group-${entry.id}`}>{entry.label}</h3><Badge variant="outline">{entry.rows.length}</Badge></div> : null}
              <StockRows canViewCosts={canViewCosts} currencyCode={currencyCode} layout={layout} rows={entry.rows} />
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function MultiStoreStockSummary({ rollups, storeCount }: { rollups: InventoryStockRollup[]; storeCount: number }) {
  return (
    <section aria-labelledby="multi-store-stock-title" className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold" id="multi-store-stock-title">Across stores</h3>
          <p className="mt-1 text-sm text-muted-foreground">Totals across {storeCount} authorized stores. Select a store level to inspect its stock activity.</p>
        </div>
        <Badge variant="outline">{rollups.length} product{rollups.length === 1 ? "" : "s"}</Badge>
      </div>

      {rollups.length ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {rollups.map((rollup) => {
            const item = rollup.rows[0];
            const attentionCount = rollup.rows.filter((row) => {
              const condition = stockCondition(row);
              return condition === "low" || condition === "negative" || condition === "out_of_stock";
            }).length;

            return (
              <article className="rounded-xl border bg-card p-4" key={rollup.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-medium">{rollupLabel(rollup)}</p><p className="mt-1 text-xs text-muted-foreground">{item.categoryName ?? "Uncategorized"} · {rollup.rows.length} store{rollup.rows.length === 1 ? "" : "s"}</p></div>
                  <div className="text-right"><p className="text-xs text-muted-foreground">Total on hand</p><p className="text-lg font-semibold">{formatQuantity(rollup.totalQuantity)} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span></p></div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-xs"><Badge variant="secondary">{rollup.availableStoreCount} available</Badge>{attentionCount ? <Badge variant="outline">{attentionCount} need attention</Badge> : <Badge variant="secondary">All stores healthy</Badge>}</div>
                <ul className="mt-4 divide-y rounded-lg border">
                  {rollup.rows.slice().sort((left, right) => left.storeName.localeCompare(right.storeName)).map((row) => (
                    <li key={row.id}><Link className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.detailHref}><span className="min-w-0 truncate font-medium">{row.storeName}</span><span className="flex shrink-0 items-center gap-2"><span>{formatQuantity(row.quantity)} {row.unit}</span><Badge variant={statusVariant(stockCondition(row))}>{inventoryStockConditionLabels[stockCondition(row)]}</Badge></span></Link></li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      ) : <p className="mt-4 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No products match the current filters across your authorized stores.</p>}
    </section>
  );
}

function StockRows({ canViewCosts, currencyCode, layout, rows }: Pick<InventoryStockViewProps, "canViewCosts" | "currencyCode"> & { layout: InventoryStockLayout; rows: InventoryStockRow[] }) {
  if (layout === "grid") {
    return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map((row) => <StockCard canViewCosts={canViewCosts} currencyCode={currencyCode} key={row.id} row={row} />)}</div>;
  }

  return (
    <>
      <div className="space-y-3 lg:hidden">{rows.map((row) => <StockCard canViewCosts={canViewCosts} currencyCode={currencyCode} key={row.id} row={row} />)}</div>
      <Card className="hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Store</th>
                <th className="px-4 py-3 text-right font-medium">On hand</th>
                <th className="px-4 py-3 font-medium">Status</th>
                {canViewCosts ? <th className="px-4 py-3 text-right font-medium">Value</th> : null}
                <th className="px-4 py-3 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => <StockListRow canViewCosts={canViewCosts} currencyCode={currencyCode} key={row.id} row={row} />)}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function StockListRow({ canViewCosts, currencyCode, row }: { canViewCosts: boolean; currencyCode: string; row: InventoryStockRow }) {
  const condition = stockCondition(row);
  const identifier = row.sku ? `SKU ${row.sku}` : row.barcode ? `Barcode ${row.barcode}` : "No SKU or barcode";

  return (
    <tr className="transition-colors hover:bg-muted/30">
      <td className="max-w-72 px-4 py-3"><Link className="block truncate rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" href={row.detailHref}>{rowLabel(row)}</Link><p className="mt-1 truncate text-xs text-muted-foreground">{identifier}</p></td>
      <td className="px-4 py-3 text-muted-foreground">{row.categoryName ?? "Uncategorized"}</td>
      <td className="px-4 py-3 text-muted-foreground">{row.storeName}</td>
      <td className="px-4 py-3 text-right"><p className="font-semibold">{formatQuantity(row.quantity)}</p><p className="text-xs text-muted-foreground">{row.unit}</p></td>
      <td className="px-4 py-3"><StatusBadges condition={condition} isAvailable={row.isAvailable} /></td>
      {canViewCosts ? <td className="px-4 py-3 text-right text-muted-foreground">{row.averageCostMinor === null ? "—" : formatMoney(row.quantity * row.averageCostMinor, currencyCode)}</td> : null}
      <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground">{formatDate(row.updatedAt)}</td>
    </tr>
  );
}

function StockCard({ canViewCosts, currencyCode, row }: { canViewCosts: boolean; currencyCode: string; row: InventoryStockRow }) {
  const condition = stockCondition(row);
  const identifier = row.sku ? `SKU: ${row.sku}` : row.barcode ? `Barcode: ${row.barcode}` : "No SKU or barcode";

  return (
    <Link className="block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" href={row.detailHref}>
    <Card className="transition-colors hover:ring-primary/30" size="sm">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="min-w-0"><CardTitle className="truncate">{rowLabel(row)}</CardTitle><CardDescription className="mt-1 truncate">{row.categoryName ?? "Uncategorized"} · {row.storeName}</CardDescription></div>
        <StatusBadges condition={condition} isAvailable={row.isAvailable} />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between gap-4"><div><p className="text-3xl font-semibold tracking-tight">{formatQuantity(row.quantity)}</p><p className="text-xs text-muted-foreground">{row.unit}</p></div><p className="text-right text-xs text-muted-foreground">Updated<br />{formatDate(row.updatedAt)}</p></div>
        <p className="truncate text-xs text-muted-foreground">{identifier}</p>
        {canViewCosts && row.averageCostMinor !== null ? <p className="text-xs text-muted-foreground">Avg. cost {formatMoney(row.averageCostMinor, currencyCode)} · Value {formatMoney(row.quantity * row.averageCostMinor, currencyCode)}</p> : null}
      </CardContent>
    </Card>
    </Link>
  );
}

function StatusBadges({ condition, isAvailable }: { condition: ReturnType<typeof stockCondition>; isAvailable: boolean }) {
  return <span className="flex flex-wrap justify-end gap-1"><Badge variant={statusVariant(condition)}>{stockStatusLabels[condition]}</Badge>{isAvailable ? <Badge variant="secondary">Available</Badge> : <Badge variant="outline">Off</Badge>}</span>;
}

function StockEmptyState({ description, title }: { description: string; title: string }) {
  return <Card><CardContent className="py-10 text-center"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-muted-foreground">{description}</p></CardContent></Card>;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatMoney(valueMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: currencyCode }).format(valueMinor / 100);
}
