import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ReportFilter } from "@/features/reports/reporting";

const selectClassName =
  "h-8 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ReportFilterForm({
  action,
  filter,
  stores,
  showExports = false,
}: {
  action: string;
  filter: ReportFilter;
  stores: Array<{ id: string; name: string }>;
  showExports?: boolean;
}) {
  const query = new URLSearchParams({ start: filter.startDate, end: filter.endDate });
  if (filter.storeId) query.set("store", filter.storeId);
  const exportQuery = query.toString();

  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card p-4">
      <form action={action} className="flex flex-wrap items-end gap-3" method="get">
        <div className="grid gap-1.5">
          <Label htmlFor={`${action}-report-start`}>From</Label>
          <Input defaultValue={filter.startDate} id={`${action}-report-start`} name="start" type="date" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${action}-report-end`}>To</Label>
          <Input defaultValue={filter.endDate} id={`${action}-report-end`} name="end" type="date" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={`${action}-report-store`}>Store</Label>
          <select className={selectClassName} defaultValue={filter.storeId ?? ""} id={`${action}-report-store`} name="store">
            <option value="">All stores</option>
            {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
          </select>
        </div>
        <Button type="submit">Apply</Button>
      </form>
      {showExports ? (
        <div className="flex flex-wrap gap-2">
          {[
            ["sales", "Sales CSV"],
            ["inventory", "Inventory CSV"],
            ["employees", "Employees CSV"],
            ["payments", "Payments CSV"],
            ["registers", "Registers CSV"],
            ["customers", "Customers CSV"],
            ["security", "Security CSV"],
          ].map(([kind, label]) => (
            <Link
              className={buttonVariants({ size: "sm", variant: "outline" })}
              href={`/api/reports/export?${exportQuery}&kind=${kind}`}
              key={kind}
            >
              {label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
