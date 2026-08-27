import { ChartColumnBig } from "lucide-react";

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

export const metadata = { title: "Back Office" };

export default async function BackOfficePage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string | string[]; end?: string | string[]; store?: string | string[] }>;
}) {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "dashboard.view")) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Back Office"
          title="Business dashboard"
          description="Your role does not include access to the organization performance dashboard."
          action={<Badge variant="outline">No dashboard access</Badge>}
        />
        <Card>
          <CardHeader>
            <ChartColumnBig aria-hidden="true" className="size-8 text-muted-foreground" />
            <CardTitle className="mt-3">Dashboard access is required</CardTitle>
            <CardDescription>
              Ask an owner to add the <span className="font-mono text-xs">dashboard.view</span> permission to one of your roles.
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
          eyebrow="Back Office"
          title="Store assignment required"
          description="Your reporting role is limited to assigned stores, but no active store has been assigned to you yet."
          action={<Badge variant="outline">No assigned store</Badge>}
        />
        <Card>
          <CardHeader>
            <ChartColumnBig aria-hidden="true" className="size-8 text-muted-foreground" />
            <CardTitle className="mt-3">Ask an owner or administrator to assign a store</CardTitle>
            <CardDescription>
              Once your employee record is assigned to a store, this dashboard will show only that store&apos;s information.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const filter = resolveScopedReportFilter(context, parameters);
  const [snapshot, stores] = await Promise.all([
    getReportingSnapshot(context, filter, "dashboard"),
    loadReportStores(context),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Back Office"
        title={`Good to see you, ${context.profile.full_name.split(" ")[0] || "there"}.`}
        description={hasOrganizationScope
          ? `Track the sales performance of ${context.organization.name} and act on the latest completed transactions.`
          : "Track completed sales and stock activity only for your assigned store."}
        action={<Badge variant="secondary">{hasOrganizationScope ? "Organization dashboard" : "Assigned-store dashboard"}</Badge>}
      />
      <ReportFilterForm
        action="/back-office"
        allowAllStores={hasOrganizationScope}
        filter={filter}
        stores={stores}
      />
      <ReportingOverview currencyCode={context.organization.currency_code} mode="dashboard" snapshot={snapshot} />
    </div>
  );
}
