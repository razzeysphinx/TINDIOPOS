import { BarChart3 } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportFilterForm } from "@/features/reports/report-filter-form";
import { loadReportStores } from "@/features/reports/data";
import { getReportingSnapshot, resolveReportFilter } from "@/features/reports/reporting";
import { ReportingOverview } from "@/features/reports/reporting-overview";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Reports" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string | string[]; end?: string | string[]; store?: string | string[] }>;
}) {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "reports.view")) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Business intelligence"
          title="Reports"
          description="Your role does not include access to sales, inventory, and employee reporting."
          action={<Badge variant="outline">No reporting access</Badge>}
        />
        <Card>
          <CardHeader>
            <BarChart3 aria-hidden="true" className="size-8 text-muted-foreground" />
            <CardTitle className="mt-3">Reporting access is required</CardTitle>
            <CardDescription>
              Ask an owner to add the <span className="font-mono text-xs">reports.view</span> permission to one of your roles.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const parameters = await searchParams;
  const filter = resolveReportFilter(parameters, context.organization.timezone);
  const [snapshot, stores] = await Promise.all([
    getReportingSnapshot(context, filter, "reports"),
    loadReportStores(context),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Business intelligence"
        title="Reports"
        description="Review completed sales, payments, team performance, and inventory activity for the selected period."
        action={<Badge variant="secondary">Reports access</Badge>}
      />
      <ReportFilterForm
        action="/back-office/reports"
        filter={filter}
        showExports
        stores={stores}
      />
      <ReportingOverview currencyCode={context.organization.currency_code} mode="reports" snapshot={snapshot} />
    </div>
  );
}
