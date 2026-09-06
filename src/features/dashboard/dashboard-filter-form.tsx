"use client";

import { useState } from "react";

import { useBackOfficeFilterNavigation } from "@/components/back-office/back-office-filter-navigation";
import { DateRangePicker } from "@/components/back-office/date-range-picker";
import { Label } from "@/components/ui/label";
import type {
  DashboardComparisonKey,
  DashboardPeriodKey,
} from "@/features/dashboard/dashboard-period";

const selectClassName =
  "h-9 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function DashboardFilterForm({
  allowAllStores,
  comparison,
  endDate,
  period,
  startDate,
  storeId,
  stores,
  timezone,
}: {
  allowAllStores: boolean;
  comparison: DashboardComparisonKey;
  endDate: string;
  period: DashboardPeriodKey;
  startDate: string;
  storeId: string | null;
  stores: Array<{ id: string; name: string }>;
  timezone: string;
}) {
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriodKey>(period);
  const { isPending, updateFilters } = useBackOfficeFilterNavigation("/back-office");

  const updatePeriod = (nextPeriod: DashboardPeriodKey) => {
    setSelectedPeriod(nextPeriod);
    // Selecting Custom only opens its date-range control. No query is made
    // until the user finishes their custom range with Done.
    if (nextPeriod === "custom") return;
    updateFilters({ end: null, period: nextPeriod, start: null });
  };

  return (
    <section aria-label="Dashboard scope" className="rounded-xl border bg-card p-3 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        {stores.length > 0 ? (
          <div className="grid min-w-0 gap-1.5 lg:min-w-44">
            <Label htmlFor="dashboard-store">Store</Label>
            <select
              className={selectClassName}
              defaultValue={storeId ?? ""}
              id="dashboard-store"
              name="store"
              onChange={(event) => updateFilters({ store: event.target.value })}
            >
              {allowAllStores ? <option value="">All stores</option> : null}
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
            </select>
          </div>
        ) : null}
        <div className="grid min-w-0 gap-1.5 lg:min-w-44">
          <Label htmlFor="dashboard-period">Period</Label>
          <select
            className={selectClassName}
            id="dashboard-period"
            name="period"
            onChange={(event) => updatePeriod(event.target.value as DashboardPeriodKey)}
            value={selectedPeriod}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="last_7_days">Last 7 days</option>
            <option value="last_30_days">Last 30 days</option>
            <option value="this_month">This month</option>
            <option value="previous_month">Previous month</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5 lg:min-w-48">
          <Label htmlFor="dashboard-comparison">Compare</Label>
          <select className={selectClassName} defaultValue={comparison} id="dashboard-comparison" name="compare" onChange={(event) => updateFilters({ compare: event.target.value })}>
            <option value="previous">Previous equivalent period</option>
            <option value="none">No comparison</option>
          </select>
        </div>
        {selectedPeriod === "custom" ? (
          <DateRangePicker
            key={`${startDate}:${endDate}`}
            endDate={endDate}
            id="dashboard-date-range"
            onCommit={({ end, start }) => updateFilters({ end, period: "custom", start })}
            startDate={startDate}
            timezone={timezone}
          />
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only">{isPending ? "Updating dashboard" : ""}</p>
    </section>
  );
}
