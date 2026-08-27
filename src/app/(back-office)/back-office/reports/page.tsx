import { BarChart3 } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportFilterForm } from "@/features/reports/report-filter-form";
import { loadReportStores } from "@/features/reports/data";
import {
  canQueryReportingScope,
  getReportingSnapshot,
  hasOrganizationReportingScope,
  resolveScopedReportFilter,
} from "@/features/reports/reporting";
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
  const [snapshot, stores] = await Promise.all([
    getReportingSnapshot(context, filter, "reports"),
    loadReportStores(context),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Business intelligence"
        title="Reports"
        description={hasOrganizationScope
          ? "Review completed sales, payments, team performance, and inventory activity for the selected period."
          : "Review completed sales, payments, team performance, and inventory activity for an assigned store."}
        action={<Badge variant="secondary">{hasOrganizationScope ? "Organization reports" : "Assigned-store reports"}</Badge>}
      />
      <ReportFilterForm
        action="/back-office/reports"
        allowAllStores={hasOrganizationScope}
        filter={filter}
        showExports
        stores={stores}
      />
      <ReportingOverview currencyCode={context.organization.currency_code} mode="reports" snapshot={snapshot} />
    </div>
  );
}
