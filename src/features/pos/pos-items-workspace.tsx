"use client";

import { PackageSearch, Tags, SlidersHorizontal, BadgePercent } from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import type { PosCatalogItem, PosCategory, PosDiscount } from "@/features/pos/pos-types";
import { cn } from "@/lib/utils";

type Tab = "items" | "categories" | "modifiers" | "discounts";

const tabs: Array<{ id: Tab; label: string; icon: typeof PackageSearch }> = [
  { id: "items", label: "Items", icon: PackageSearch },
  { id: "categories", label: "Categories", icon: Tags },
  { id: "modifiers", label: "Modifiers", icon: SlidersHorizontal },
  { id: "discounts", label: "Discounts", icon: BadgePercent },
];

export function PosItemsWorkspace({
  canApplyDiscounts,
  categories,
  currencyCode,
  discounts,
  items,
}: {
  canApplyDiscounts: boolean;
  categories: PosCategory[];
  currencyCode: string;
  discounts: PosDiscount[];
  items: PosCatalogItem[];
}) {
  const [tab, setTab] = useState<Tab>("items");
  const [query, setQuery] = useState("");
  const matchingItems = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    if (!search) return items;
    return items.filter((item) => [item.productName, item.variantName, item.sku, item.barcode].filter(Boolean).some((value) => value?.toLocaleLowerCase().includes(search)));
  }, [items, query]);

  return (
    <div className="space-y-5">
      <div className="flex gap-2 overflow-x-auto border-b pb-2" role="tablist">
        {tabs.filter(({ id }) => id !== "discounts" || canApplyDiscounts).map(({ id, icon: Icon, label }) => (
          <button aria-selected={tab === id} className={cn("inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium", tab === id ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted")} key={id} onClick={() => setTab(id)} role="tab" type="button"><Icon className="size-4" />{label}</button>
        ))}
      </div>

      {tab === "items" ? (
        <>
          <Input onChange={(event) => setQuery(event.target.value)} placeholder="Search operational items, SKU, or barcode" value={query} />
          <Card><CardContent className="p-0"><div className="divide-y">{matchingItems.length > 0 ? matchingItems.map((item) => <div className="flex items-center justify-between gap-3 px-4 py-3" key={`${item.productId}:${item.variantId ?? "base"}`}><div className="min-w-0"><p className="truncate text-sm font-medium">{item.productName}{item.variantName ? ` · ${item.variantName}` : ""}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.sku ?? item.barcode ?? "No scanned code"} · {item.unit}</p></div><div className="flex shrink-0 items-center gap-2"><span className="font-semibold">{item.isVariablePrice ? "Variable" : formatMinorMoney(item.priceMinor, currencyCode)}</span>{item.hasModifiers ? <Badge variant="outline">Modifiers</Badge> : null}</div></div>) : <p className="p-5 text-sm text-muted-foreground">No operational items match this search.</p>}</div></CardContent></Card>
        </>
      ) : null}

      {tab === "categories" ? <Card><CardHeader><CardTitle>POS browsing categories</CardTitle><p className="mt-1 text-sm text-muted-foreground">Categories filter selling items. Category administration remains in Back Office.</p></CardHeader><CardContent className="flex flex-wrap gap-2">{categories.length > 0 ? categories.map((category) => <Badge key={category.id} variant="outline">{category.name}</Badge>) : <p className="text-sm text-muted-foreground">No active categories are available.</p>}</CardContent></Card> : null}
      {tab === "modifiers" ? <Card><CardHeader><CardTitle>Selling modifiers</CardTitle><p className="mt-1 text-sm text-muted-foreground">Modifiers are selected for eligible products during a sale. This operational view never exposes modifier configuration.</p></CardHeader><CardContent><p className="text-sm text-muted-foreground">{items.filter((item) => item.hasModifiers).length} visible item{items.filter((item) => item.hasModifiers).length === 1 ? " has" : "s have"} modifier choices in the active POS catalog.</p></CardContent></Card> : null}
      {tab === "discounts" && canApplyDiscounts ? <Card><CardHeader><CardTitle>Available sale discounts</CardTitle><p className="mt-1 text-sm text-muted-foreground">Discount configuration remains in Back Office. Applying a discount is validated by the existing checkout service and any configured manager approval rules.</p></CardHeader><CardContent className="divide-y rounded-lg border p-0">{discounts.length > 0 ? discounts.map((discount) => <div className="flex items-center justify-between gap-3 px-4 py-3" key={discount.id}><span className="font-medium">{discount.name}</span><Badge variant="outline">{discount.discountType === "percentage" ? `${(discount.percentageBps ?? 0) / 100}%` : formatMinorMoney(discount.amountMinor ?? 0, currencyCode)}</Badge></div>) : <p className="p-4 text-sm text-muted-foreground">No active discounts are available.</p>}</CardContent></Card> : null}
    </div>
  );
}
