"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type FilterStoreOption = {
  id: string;
  name: string;
};

const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * A compact, server-form-compatible filter bar for Back Office pages.
 * Individual pages opt into only the fields their data query supports.
 */
export function GlobalFilterBar({
  action,
  activeAdditionalFilterCount = 0,
  additionalFields,
  additionalFiltersLabel = "More filters",
  allowAllStores = true,
  collapsibleAdditionalFields = false,
  fromDate,
  hiddenFields,
  embedded = false,
  namePrefix,
  primaryAdditionalFields,
  storeId,
  stores = [],
  toDate,
  trailing,
  showDateRange = true,
  showEmbeddedDividers = true,
  showStore = stores.length > 0,
}: {
  action: string;
  activeAdditionalFilterCount?: number;
  additionalFields?: ReactNode;
  additionalFiltersLabel?: string;
  allowAllStores?: boolean;
  collapsibleAdditionalFields?: boolean;
  fromDate?: string;
  hiddenFields?: Record<string, string | undefined>;
  /** Renders inside an existing card while retaining the same form/query behavior. */
  embedded?: boolean;
  namePrefix: string;
  /** Optional compact fields that belong in the always-visible filter row. */
  primaryAdditionalFields?: ReactNode;
  storeId?: string | null;
  stores?: FilterStoreOption[];
  toDate?: string;
  trailing?: ReactNode;
  showDateRange?: boolean;
  /** Keeps the default embedded separator treatment unless a host card uses spacing instead. */
  showEmbeddedDividers?: boolean;
  showStore?: boolean;
}) {
  const hasStoreFilter = showStore && stores.length > 0;
  const hasCollapsibleAdditionalFields = collapsibleAdditionalFields && additionalFields !== undefined;
  const [additionalFiltersOpen, setAdditionalFiltersOpen] = useState(false);
  const additionalFilterCount = Math.max(0, activeAdditionalFilterCount);

  return (
    <section aria-label="Page filters" className={cn(
      embedded ? cn("py-3", showEmbeddedDividers && "border-y bg-muted/20") : "rounded-2xl border bg-card p-3 shadow-sm sm:p-4",
    )}>
      <div className={cn("flex flex-col gap-3", trailing ? "xl:flex-row xl:items-end xl:justify-between" : undefined)}>
        <form
          action={action}
          className="grid gap-x-2.5 gap-y-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end"
          method="get"
        >
          {Object.entries(hiddenFields ?? {}).map(([name, value]) =>
            value === undefined ? null : <input key={name} name={name} type="hidden" value={value} />,
          )}
          {showDateRange ? (
            <>
              <div className="grid min-w-0 gap-1.5 lg:min-w-36 lg:flex-none">
                <Label htmlFor={`${namePrefix}-from-date`}>From date</Label>
                <Input defaultValue={fromDate} id={`${namePrefix}-from-date`} name="start" type="date" />
              </div>
              <div className="grid min-w-0 gap-1.5 lg:min-w-36 lg:flex-none">
                <Label htmlFor={`${namePrefix}-to-date`}>To date</Label>
                <Input defaultValue={toDate} id={`${namePrefix}-to-date`} name="end" type="date" />
              </div>
            </>
          ) : null}
          {hasStoreFilter ? (
            <div className="grid min-w-0 gap-1.5 lg:min-w-36 lg:flex-none">
              <Label htmlFor={`${namePrefix}-store`}>Store</Label>
              <select
                className={selectClassName}
                defaultValue={storeId ?? ""}
                id={`${namePrefix}-store`}
                name="store"
              >
                {allowAllStores ? <option value="">All stores</option> : null}
                {stores.map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {primaryAdditionalFields}
          {hasCollapsibleAdditionalFields ? (
            <div className="flex min-w-0 items-end lg:flex-none">
              <Button
                aria-controls={`${namePrefix}-additional-filters`}
                aria-expanded={additionalFiltersOpen}
                className="w-full sm:w-auto"
                onClick={() => setAdditionalFiltersOpen((current) => !current)}
                type="button"
                variant="outline"
              >
                {additionalFiltersLabel}{additionalFilterCount > 0 ? ` · ${additionalFilterCount}` : ""}
                <ChevronDown aria-hidden="true" className={cn("transition-transform", additionalFiltersOpen && "rotate-180")} />
              </Button>
            </div>
          ) : additionalFields}
          <Button className="w-full sm:col-span-2 sm:w-auto lg:col-span-1" type="submit">
            Apply
          </Button>
          {hasCollapsibleAdditionalFields && additionalFiltersOpen ? (
            <div
              className="grid gap-3 rounded-lg border bg-background/70 p-3 sm:col-span-2 sm:grid-cols-2 lg:basis-full lg:grid-cols-3"
              id={`${namePrefix}-additional-filters`}
            >
              {additionalFields}
            </div>
          ) : null}
        </form>
        {trailing ? <div className="flex flex-wrap gap-2 xl:justify-end">{trailing}</div> : null}
      </div>
    </section>
  );
}
