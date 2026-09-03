import { ChartColumnBig, CircleDollarSign, PackageSearch, ShieldCheck, Warehouse } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardActionGrid } from "@/features/dashboard/dashboard-action-grid";
import { BeginnerSetupGuide } from "@/features/dashboard/beginner-setup-guide";
import { loadBeginnerSetupItems } from "@/features/dashboard/data";
import { NeedsAttention, type NeedsAttentionItem } from "@/features/dashboard/needs-attention";
import { ReportFilterForm } from "@/features/reports/report-filter-form";
import { loadReportStores } from "@/features/reports/data";
import {
  canQueryReportingScope,
  getReportingSnapshot,
  hasAuthorizedReportStoreSelection,
  hasOrganizationReportingScope,
  resolveScopedReportFilter,
} from "@/features/reports/reporting";
import { ReportingOverview } from "@/features/reports/reporting-overview";
import { hasAnyPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Back Office" };

export default async function BackOfficePage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string | string[]; end?: string | string[]; store?: string | string[] }>;
}) {
  const context = await requireBackOfficePermission("dashboard.view");

  const parameters = await searchParams;
  if (!hasAuthorizedReportStoreSelection(context, parameters)) notFound();
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
  const [snapshot, stores, setupItems] = await Promise.all([
    getReportingSnapshot(context, filter, "dashboard"),
    loadReportStores(context),
    loadBeginnerSetupItems(context),
  ]);
  const attentionItems: NeedsAttentionItem[] = [];
  const canUseInventory = context.features.inventory
    && hasAnyPermission(context, ["inventory.view", "inventory.manage"]);

  if (canUseInventory && snapshot.inventory.low_stock_count > 0) {
    attentionItems.push({
      description: "Recorded stock is at or below its warning level.",
      href: "/back-office/inventory?tab=stock&status=low",
      icon: PackageSearch,
      label: "Items low on stock",
      value: String(snapshot.inventory.low_stock_count),
    });
  }
  if (canUseInventory && snapshot.inventory.out_of_stock_count > 0) {
    attentionItems.push({
      description: "These tracked items have no recorded quantity available.",
      href: "/back-office/inventory?tab=stock&status=out_of_stock",
      icon: Warehouse,
      label: "Items out of stock",
      value: String(snapshot.inventory.out_of_stock_count),
    });
  }
  if (canUseInventory && snapshot.inventory.negative_stock_count > 0) {
    attentionItems.push({
      description: "More stock left than TINDIO recorded as available.",
      href: "/back-office/inventory?tab=stock&status=negative",
      icon: Warehouse,
      label: "Negative stock records",
      value: String(snapshot.inventory.negative_stock_count),
    });
  }
  if (snapshot.security.cash_discrepancy_count > 0) {
    attentionItems.push({
      description: "Closed shifts with a counted cash difference in this period.",
      href: "/back-office/shifts",
      icon: CircleDollarSign,
      label: "Shifts with cash differences",
      value: String(snapshot.security.cash_discrepancy_count),
    });
  }
  if (hasAnyPermission(context, ["approvals.manage", "audit.view"]) && snapshot.security.manager_approval_count > 0) {
    attentionItems.push({
      description: "Approval-related actions recorded in this period.",
      href: "/back-office/security",
      icon: ShieldCheck,
      label: "Approval activity to review",
      value: String(snapshot.security.manager_approval_count),
    });
  }

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
      {setupItems ? <BeginnerSetupGuide items={setupItems} /> : null}
      <NeedsAttention items={attentionItems} />
      <DashboardActionGrid
        inventoryEnabled={context.features.inventory}
        permissions={context.permissions}
        surface="business"
      />
      <ReportingOverview
        currencyCode={context.organization.currency_code}
        mode="dashboard"
        snapshot={snapshot}
      />
    </div>
  );
}
