import { BarChart3 } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportFilterForm } from "@/features/reports/report-filter-form";
import { BusinessReportsNavigation } from "@/features/reports/business-reports-navigation";
import { loadReportStores } from "@/features/reports/data";
import {
  canQueryReportingScope,
  getReportingSnapshot,
  hasAuthorizedReportStoreSelection,
  hasOrganizationReportingScope,
  resolveScopedReportFilter,
  reportQueryString,
} from "@/features/reports/reporting";
import { ReportingOverview } from "@/features/reports/reporting-overview";
import { resolveBusinessReportSection } from "@/features/reports/report-sections";
import { requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string | string[]; end?: string | string[]; store?: string | string[]; section?: string | string[] }>;
}) {
  const context = await requireBackOfficePermission("reports.view");

  const parameters = await searchParams;
  if (!hasAuthorizedReportStoreSelection(context, parameters)) notFound();
  const hasOrganizationScope = hasOrganizationReportingScope(context);

  if (!canQueryReportingScope(context)) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Business intelligence"
          title="Store assignment required"
          description="Your reporting role is limited to assigned stores, but no active store has been assigned to you yet."
          action={<Badge variant="outline">No assigned store</Badge>}
        />
        <Card>
          <CardHeader>
            <BarChart3 aria-hidden="true" className="size-8 text-muted-foreground" />
            <CardTitle className="mt-3">Ask an owner or administrator to assign a store</CardTitle>
            <CardDescription>
              Reporting and exports will become available for the stores assigned to your employee record.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const filter = resolveScopedReportFilter(context, parameters);
  const section = resolveBusinessReportSection(typeof parameters.section === "string" ? parameters.section : undefined);
  const [snapshot, stores] = await Promise.all([
    getReportingSnapshot(context, filter, "reports"),
    loadReportStores(context),
  ]);
  const selectedStoreName = filter.storeId
    ? stores.find((store) => store.id === filter.storeId)?.name ?? "Selected store"
    : "All authorized stores";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Business intelligence"
        title="Business Reports"
        description={hasOrganizationScope
          ? "Understand sales, products, stock, operations, customers, team performance, and accountability for the selected period."
          : "Understand sales, products, stock, operations, customers, team performance, and accountability for your assigned stores."}
        action={<Badge variant="secondary">{hasOrganizationScope ? "Organization reports" : "Assigned-store reports"}</Badge>}
        breadcrumbs={[{ href: "/back-office", label: "Back Office" }, { label: "Reports" }, { label: "Business reports" }]}
      />
      <BusinessReportsNavigation activeSection={section} filterQuery={reportQueryString(filter)} />
      <ReportFilterForm
        action="/back-office/reports"
        allowAllStores={hasOrganizationScope}
        filter={filter}
        showExports
        stores={stores}
        section={section}
      />
      <ReportingOverview
        currencyCode={context.organization.currency_code}
        mode="reports"
        printContext={{
          endDate: filter.endDate,
          organizationName: context.organization.name,
          startDate: filter.startDate,
          storeName: selectedStoreName,
          timezone: context.organization.timezone,
        }}
        navigationQuery={reportQueryString(filter)}
        section={section}
        snapshot={snapshot}
      />
    </div>
  );
}
