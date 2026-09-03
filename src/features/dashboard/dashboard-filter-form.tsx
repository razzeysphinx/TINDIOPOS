"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
}: {
  allowAllStores: boolean;
  comparison: DashboardComparisonKey;
  endDate: string;
  period: DashboardPeriodKey;
  startDate: string;
  storeId: string | null;
  stores: Array<{ id: string; name: string }>;
}) {
  const [selectedPeriod, setSelectedPeriod] = useState<DashboardPeriodKey>(period);

  return (
    <section aria-label="Dashboard scope" className="rounded-xl border bg-card p-3 shadow-sm">
      <form action="/back-office" className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end" method="get">
        {stores.length > 0 ? (
          <div className="grid min-w-0 gap-1.5 lg:min-w-44">
            <Label htmlFor="dashboard-store">Store</Label>
            <select className={selectClassName} defaultValue={storeId ?? ""} id="dashboard-store" name="store">
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
            onChange={(event) => setSelectedPeriod(event.target.value as DashboardPeriodKey)}
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
          <select className={selectClassName} defaultValue={comparison} id="dashboard-comparison" name="compare">
            <option value="previous">Previous equivalent period</option>
            <option value="none">No comparison</option>
          </select>
        </div>
        {selectedPeriod === "custom" ? (
          <>
            <div className="grid min-w-0 gap-1.5 lg:min-w-40">
              <Label htmlFor="dashboard-start">From date</Label>
              <Input defaultValue={startDate} id="dashboard-start" name="start" type="date" />
            </div>
            <div className="grid min-w-0 gap-1.5 lg:min-w-40">
              <Label htmlFor="dashboard-end">To date</Label>
              <Input defaultValue={endDate} id="dashboard-end" name="end" type="date" />
            </div>
          </>
        ) : null}
        <Button className="sm:col-span-2 sm:w-auto" type="submit">Apply</Button>
      </form>
    </section>
  );
}
