import { Suspense } from "react";
import { ChartColumnBig } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BeginnerSetupGuide } from "@/features/dashboard/beginner-setup-guide";
import {
  loadBeginnerSetupItems,
  loadDashboardOperationalSnapshot,
  type DashboardOperationalSnapshot,
} from "@/features/dashboard/data";
import { DashboardFilterForm } from "@/features/dashboard/dashboard-filter-form";
import {
  dashboardQueryString,
  resolveDashboardPeriod,
  type DashboardPeriod,
  type DashboardSearchParams,
} from "@/features/dashboard/dashboard-period";
import { OwnerDashboard } from "@/features/dashboard/owner-dashboard";
import { loadReportStores } from "@/features/reports/data";
import {
  canQueryReportingScope,
  getReportingSnapshot,
  hasAuthorizedReportStoreSelection,
  hasOrganizationReportingScope,
  reportQueryString,
  resolveScopedReportFilter,
  type ReportSnapshot,
} from "@/features/reports/reporting";
import { requireBackOfficePermission, type BusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Back Office" };

function DashboardSectionsLoading() {
  return (
    <div aria-label="Dashboard sections loading" aria-live="polite" className="space-y-7">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => <div className="h-32 animate-pulse rounded-xl border bg-card" key={index} />)}
      </div>
      <div className="h-44 animate-pulse rounded-xl border bg-card" />
      <div className="grid gap-4 xl:grid-cols-2"><div className="h-80 animate-pulse rounded-xl border bg-card" /><div className="h-80 animate-pulse rounded-xl border bg-card" /></div>
      <span className="sr-only">Loading business performance, operations, and inventory.</span>
    </div>
  );
}

async function DashboardSections({
  context,
  operationsPromise,
  period,
  snapshotPromise,
  previousSnapshotPromise,
}: {
  context: BusinessContext;
  operationsPromise: Promise<DashboardOperationalSnapshot>;
  period: DashboardPeriod;
  snapshotPromise: Promise<ReportSnapshot>;
  previousSnapshotPromise: Promise<ReportSnapshot | null>;
}) {
  const [snapshot, previousSnapshot, operations] = await Promise.all([
    snapshotPromise,
    previousSnapshotPromise,
    operationsPromise,
  ]);
  const query = reportQueryString(period.filter);

  return (
    <>
      <OwnerDashboard
        comparisonLabel={period.comparisonLabel}
        currencyCode={context.organization.currency_code}
        current={snapshot}
        dashboardQuery={dashboardQueryString(period, null)}
        features={{
          deviceManagement: context.organization.device_management_enabled,
          inventory: context.features.inventory,
          openTickets: context.features.open_tickets,
          shifts: context.features.shifts,
          timeClock: context.features.time_clock,
        }}
        operations={operations}
        permissions={context.permissions}
        previous={previousSnapshot}
        query={query}
        selectedStoreId={period.filter.storeId}
      />
    </>
  );
}

async function DashboardSetup({
  setupItemsPromise,
}: {
  setupItemsPromise: ReturnType<typeof loadBeginnerSetupItems>;
}) {
  const setupItems = await setupItemsPromise;
  return setupItems ? <BeginnerSetupGuide items={setupItems} /> : null;
}

export default async function BackOfficePage({
  searchParams,
}: {
  searchParams: Promise<DashboardSearchParams>;
}) {
  const context = await requireBackOfficePermission("dashboard.view");
  const parameters = await searchParams;
  if (!hasAuthorizedReportStoreSelection(context, parameters)) notFound();
  const hasOrganizationScope = hasOrganizationReportingScope(context);

  if (!canQueryReportingScope(context)) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Back Office" title="Store assignment required" description="Your reporting role is limited to assigned stores, but no active store has been assigned to you yet." action={<Badge variant="outline">No assigned store</Badge>} />
        <Card><CardHeader><ChartColumnBig aria-hidden="true" className="size-8 text-muted-foreground" /><CardTitle className="mt-3">Ask an owner or administrator to assign a store</CardTitle><CardDescription>Once assigned, this dashboard will show only that store&apos;s information.</CardDescription></CardHeader></Card>
      </div>
    );
  }

  const stores = await loadReportStores(context);
  const scopedReportFilter = resolveScopedReportFilter(context, parameters);
  const selectedStoreId = hasOrganizationScope
    ? scopedReportFilter.storeId
    : scopedReportFilter.storeId ?? stores[0]?.id ?? null;
  const period = resolveDashboardPeriod(parameters, context.organization.timezone, selectedStoreId);
  const snapshotPromise = getReportingSnapshot(context, period.filter, "dashboard");
  const previousSnapshotPromise = period.comparisonFilter
    ? getReportingSnapshot(context, period.comparisonFilter, "dashboard")
    : Promise.resolve(null);
  const operationsPromise = loadDashboardOperationalSnapshot(context, period.filter);
  const setupItemsPromise = loadBeginnerSetupItems(context);
  const selectedStoreName = selectedStoreId
    ? stores.find((store) => store.id === selectedStoreId)?.name ?? "Selected store"
    : "All stores";
  const dashboardStateKey = dashboardQueryString(period, selectedStoreId);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Back Office"
        title="Dashboard"
        description={`${context.organization.name} · ${selectedStoreName} · ${period.periodLabel}`}
        showDescription
      />
      <DashboardFilterForm
        key={`filters:${dashboardStateKey}`}
        allowAllStores={hasOrganizationScope}
        comparison={period.comparison}
        endDate={period.filter.endDate}
        period={period.period}
        startDate={period.filter.startDate}
        storeId={selectedStoreId}
        stores={stores}
        timezone={context.organization.timezone}
      />
      <Suspense fallback={<DashboardSectionsLoading />} key={`sections:${dashboardStateKey}`}>
        <DashboardSections
          context={context}
          operationsPromise={operationsPromise}
          period={period}
          previousSnapshotPromise={previousSnapshotPromise}
          snapshotPromise={snapshotPromise}
        />
      </Suspense>
      <Suspense fallback={null}>
        <DashboardSetup setupItemsPromise={setupItemsPromise} />
      </Suspense>
    </div>
  );
}
