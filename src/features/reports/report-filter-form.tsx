import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { ReportExportActions } from "@/features/reports/report-export-actions";
import type { ReportFilter } from "@/features/reports/reporting";
import type { BusinessReportSection } from "@/features/reports/report-sections";

export function ReportFilterForm({
  action,
  filter,
  stores,
  showExports = false,
  allowAllStores = true,
  section,
}: {
  action: string;
  filter: ReportFilter;
  stores: Array<{ id: string; name: string }>;
  showExports?: boolean;
  allowAllStores?: boolean;
  section?: BusinessReportSection;
}) {
  const query = new URLSearchParams({ start: filter.startDate, end: filter.endDate });
  if (filter.storeId) query.set("store", filter.storeId);
  const exportQuery = query.toString();

  return (
    <GlobalFilterBar
      action={action}
      allowAllStores={allowAllStores}
      fromDate={filter.startDate}
      hiddenFields={section ? { section } : undefined}
      namePrefix="report-filter"
      storeId={filter.storeId}
      stores={stores}
      toDate={filter.endDate}
      trailing={showExports ? (
        <ReportExportActions exportQuery={exportQuery} section={section} />
      ) : undefined}
    />
  );
}
