import { ChartColumnBig } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportFilterForm } from "@/features/reports/report-filter-form";
import { getReportingSnapshot, resolveReportFilter } from "@/features/reports/reporting";
import { ReportingOverview } from "@/features/reports/reporting-overview";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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
  const filter = resolveReportFilter(parameters, context.organization.timezone);
  const supabase = await createClient();
  const [snapshot, storesResult] = await Promise.all([
    getReportingSnapshot(context, filter, "dashboard"),
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .order("name"),
  ]);

  if (storesResult.error) {
    throw new Error(`Unable to load dashboard stores: ${storesResult.error.message}`);
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Back Office"
        title={`Good to see you, ${context.profile.full_name.split(" ")[0] || "there"}.`}
        description={`Track the sales performance of ${context.organization.name} and act on the latest completed transactions.`}
        action={<Badge variant="secondary">Dashboard access</Badge>}
      />
      <ReportFilterForm action="/back-office" filter={filter} stores={storesResult.data ?? []} />
      <ReportingOverview currencyCode={context.organization.currency_code} mode="dashboard" snapshot={snapshot} />
    </div>
  );
}
