import Link from "next/link";

import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { buttonVariants } from "@/components/ui/button";
import type { ReportFilter } from "@/features/reports/reporting";

export function ReportFilterForm({
  action,
  filter,
  stores,
  showExports = false,
  allowAllStores = true,
}: {
  action: string;
  filter: ReportFilter;
  stores: Array<{ id: string; name: string }>;
  showExports?: boolean;
  allowAllStores?: boolean;
}) {
  const query = new URLSearchParams({ start: filter.startDate, end: filter.endDate });
  if (filter.storeId) query.set("store", filter.storeId);
  const exportQuery = query.toString();

  return (
    <GlobalFilterBar
      action={action}
      allowAllStores={allowAllStores}
      fromDate={filter.startDate}
      namePrefix="report-filter"
      storeId={filter.storeId}
      stores={stores}
      toDate={filter.endDate}
      trailing={showExports ? (
        <>
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
        </>
      ) : undefined}
    />
  );
}
