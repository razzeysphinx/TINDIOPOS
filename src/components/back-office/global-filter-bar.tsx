import type { ReactNode } from "react";

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
  additionalFields,
  allowAllStores = true,
  fromDate,
  hiddenFields,
  namePrefix,
  storeId,
  stores = [],
  toDate,
  trailing,
  showDateRange = true,
  showStore = stores.length > 0,
}: {
  action: string;
  additionalFields?: ReactNode;
  allowAllStores?: boolean;
  fromDate?: string;
  hiddenFields?: Record<string, string | undefined>;
  namePrefix: string;
  storeId?: string | null;
  stores?: FilterStoreOption[];
  toDate?: string;
  trailing?: ReactNode;
  showDateRange?: boolean;
  showStore?: boolean;
}) {
  const hasStoreFilter = showStore && stores.length > 0;

  return (
    <section aria-label="Page filters" className="rounded-2xl border bg-card p-3 shadow-sm sm:p-4">
      <div className={cn("flex flex-col gap-3", trailing ? "xl:flex-row xl:items-end xl:justify-between" : undefined)}>
        <form
          action={action}
          className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end"
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
          {additionalFields}
          <Button className="w-full sm:col-span-2 sm:w-auto lg:col-span-1" type="submit">
            Apply
          </Button>
        </form>
        {trailing ? <div className="flex flex-wrap gap-2 xl:justify-end">{trailing}</div> : null}
      </div>
    </section>
  );
}
