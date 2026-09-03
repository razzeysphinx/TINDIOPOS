"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowRight,
  ChartColumnBig,
  CircleDollarSign,
  MonitorSmartphone,
  PackagePlus,
  ReceiptText,
  Store,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";

import { ContextHelp } from "@/components/back-office/context-help";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import type { DashboardOperationalSnapshot } from "@/features/dashboard/data";
import { NeedsAttention, type NeedsAttentionItem } from "@/features/dashboard/needs-attention";
import type { ReportSnapshot } from "@/features/reports/reporting";
import { cn } from "@/lib/utils";

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(value);
}

function formatChartDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { day: "numeric", month: "short" }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function percentOf(value: number, total: number) {
  if (total === 0) return value === 0 ? "0%" : "—";
  return `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(value / total * 100)}%`;
}

function signedQuantity(value: number) {
  if (value === 0) return "No change";
  return `${value > 0 ? "+" : ""}${formatQuantity(value)}`;
}

function ComparisonText({
  current,
  previous,
  comparisonLabel,
  format = "percent",
  currencyCode,
}: {
  current: number;
  previous: number | null;
  comparisonLabel: string | null;
  format?: "currency" | "number" | "percent";
  currencyCode: string;
}) {
  if (previous === null || comparisonLabel === null) return <span>No comparison selected</span>;
  const difference = current - previous;
  if (format === "number") return <span>{signedQuantity(difference)} vs {comparisonLabel}</span>;
  if (format === "currency") {
    return <span>{difference > 0 ? "+" : difference < 0 ? "−" : ""}{formatMinorMoney(Math.abs(difference), currencyCode)} vs {comparisonLabel}</span>;
  }
  if (previous === 0) return <span>{current === 0 ? "No change" : "New activity"} vs {comparisonLabel}</span>;
  const change = (current - previous) / Math.abs(previous) * 100;
  return (
    <span className={change < 0 ? "text-destructive" : change > 0 ? "text-primary" : undefined}>
      {change > 0 ? "↑ " : change < 0 ? "↓ " : ""}{new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(Math.abs(change))}% vs {comparisonLabel}
    </span>
  );
}

function SectionHeading({ eyebrow, id, title, description }: { eyebrow: string; id?: string; title: string; description: string }) {
  return (
    <div>
      <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-[-0.025em]" id={id}>{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function KpiCard({
  detail,
  help,
  icon: Icon,
  label,
  tone = "default",
  value,
}: {
  detail: React.ReactNode;
  help: string;
  icon: typeof TrendingUp;
  label: string;
  tone?: "default" | "negative" | "positive" | "warning";
  value: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 gap-3 py-4">
      <CardHeader className="flex-row items-start justify-between gap-2 px-4">
        <p className="flex min-w-0 items-center text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {label}<ContextHelp label={`What is ${label}?`}>{help}</ContextHelp>
        </p>
        <span className={cn(
          "grid size-8 shrink-0 place-items-center rounded-lg",
          tone === "positive" && "bg-primary/10 text-primary",
          tone === "negative" && "bg-destructive/10 text-destructive",
          tone === "warning" && "bg-amber-500/15 text-amber-700 dark:text-amber-300",
          tone === "default" && "bg-secondary text-secondary-foreground",
        )}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </CardHeader>
      <CardContent className="px-4">
        <p className="break-words text-2xl font-semibold tracking-[-0.04em]">{value}</p>
        <p className="mt-1 min-h-8 text-xs leading-4 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function OperationLink({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link className="group rounded-lg border bg-background p-3 outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring" href={href}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center justify-between gap-2 text-lg font-semibold">
        {value}<ArrowRight aria-hidden="true" className="size-4 text-primary transition-transform group-hover:translate-x-0.5" />
      </p>
    </Link>
  );
}

export function OwnerDashboard({
  comparisonLabel,
  currencyCode,
  current,
  dashboardQuery,
  features,
  operations,
  permissions,
  previous,
  query,
  selectedStoreId,
}: {
  comparisonLabel: string | null;
  currencyCode: string;
  current: ReportSnapshot;
  dashboardQuery: string;
  features: {
    deviceManagement: boolean;
    inventory: boolean;
    openTickets: boolean;
    shifts: boolean;
    timeClock: boolean;
  };
  operations: DashboardOperationalSnapshot;
  permissions: readonly string[];
  previous: ReportSnapshot | null;
  query: string;
  selectedStoreId: string | null;
}) {
  const summary = current.summary;
  const previousSummary = previous?.summary ?? null;
  const reportHref = `/back-office/reports?${query}`;
  const inventorySuffix = selectedStoreId ? `&store=${selectedStoreId}` : "";
  const shiftHref = `/back-office/shifts?${query}`;
  const securityHref = selectedStoreId ? `/back-office/security?store=${selectedStoreId}` : "/back-office/security";
  const syncHref = selectedStoreId ? `/back-office/offline-sync?store=${selectedStoreId}` : "/back-office/offline-sync";
  const devicesHref = selectedStoreId ? `/back-office/devices?store=${selectedStoreId}` : "/back-office/devices";
  const costComplete = operations.cost.missing_sales_cost_line_count === 0;
  const inventoryCostComplete = operations.cost.missing_inventory_cost_count === 0;
  const attentionItems: NeedsAttentionItem[] = [];

  if (features.shifts && operations.access.shifts && current.security.cash_discrepancy_count > 0) {
    attentionItems.push({
      description: "Closed shifts have a counted cash difference in the selected period.",
      href: shiftHref,
      label: "cash differences",
      severity: "critical",
      value: formatQuantity(current.security.cash_discrepancy_count),
    });
  }
  if (features.inventory && operations.access.inventory && (operations.inventory.negative_stock_count ?? 0) > 0) {
    attentionItems.push({
      description: "Recorded quantities below zero need a neutral stock review.",
      href: `/back-office/inventory?tab=stock&status=negative${inventorySuffix}`,
      label: "negative-stock records",
      severity: "critical",
      value: formatQuantity(operations.inventory.negative_stock_count ?? 0),
    });
  }
  if (features.deviceManagement && operations.access.devices && (operations.operations.sync_issue_count ?? 0) > 0) {
    attentionItems.push({
      description: "Server-observed offline sales ended in a conflict or failure.",
      href: syncHref,
      label: "sync problems",
      severity: "critical",
      value: formatQuantity(operations.operations.sync_issue_count ?? 0),
    });
  }
  if (features.inventory && operations.access.inventory && (operations.inventory.out_of_stock_count ?? 0) > 0) {
    attentionItems.push({
      description: "Tracked products have no recorded quantity available.",
      href: `/back-office/inventory?tab=stock&status=out_of_stock${inventorySuffix}`,
      label: "out-of-stock records",
      severity: "needs_attention",
      value: formatQuantity(operations.inventory.out_of_stock_count ?? 0),
    });
  }
  if (operations.access.approvals && (operations.operations.pending_approval_count ?? 0) > 0) {
    attentionItems.push({
      description: "Unexpired approval requests are waiting for an authorized reviewer.",
      href: securityHref,
      label: "pending approvals",
      severity: "needs_attention",
      value: formatQuantity(operations.operations.pending_approval_count ?? 0),
    });
  }
  if (features.deviceManagement && operations.access.devices && (operations.operations.devices_not_seen_recently_count ?? 0) > 0) {
    attentionItems.push({
      description: "Active managed devices have not checked in during the last 15 minutes; they may simply be unused.",
      href: devicesHref,
      label: "devices not seen recently",
      severity: "needs_attention",
      value: formatQuantity(operations.operations.devices_not_seen_recently_count ?? 0),
    });
  }
  if (features.inventory && operations.access.inventory && (operations.inventory.low_stock_count ?? 0) > 0) {
    attentionItems.push({
      description: "Positive stock is at or below its configured warning level.",
      href: `/back-office/inventory?tab=stock&status=low${inventorySuffix}`,
      label: "low-stock records",
      severity: "watch",
      value: formatQuantity(operations.inventory.low_stock_count ?? 0),
    });
  }

  const salesByDay = current.sales_by_day.map((day) => ({
    label: formatChartDate(day.date),
    net: day.net_sales_minor / 100,
  }));
  const showStorePerformance = operations.access.organization_wide
    && selectedStoreId === null
    && operations.store_performance.length > 1;
  const paymentTotal = current.payments.reduce((total, payment) => total + payment.amount_minor, 0);
  const showPeople = operations.access.team || operations.access.customers;

  return (
    <div className="space-y-7">
      <section aria-labelledby="executive-snapshot-title" className="space-y-3">
        <SectionHeading description="The business outcome for the selected store and period." eyebrow="Performance" id="executive-snapshot-title" title="Executive snapshot" />
        <div className={cn("grid gap-3 sm:grid-cols-2", operations.access.cost ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
          <KpiCard
            detail={<ComparisonText comparisonLabel={comparisonLabel} currencyCode={currencyCode} current={summary.net_sales_minor} previous={previousSummary?.net_sales_minor ?? null} />}
            help="Completed sales minus recorded refunds for the selected period."
            icon={TrendingUp}
            label="Net sales"
            tone="positive"
            value={formatMinorMoney(summary.net_sales_minor, currencyCode)}
          />
          <KpiCard
            detail={<ComparisonText comparisonLabel={comparisonLabel} currencyCode={currencyCode} current={summary.transaction_count} format="number" previous={previousSummary?.transaction_count ?? null} />}
            help="The number of completed sales in the selected period."
            icon={ReceiptText}
            label="Transactions"
            value={formatQuantity(summary.transaction_count)}
          />
          <KpiCard
            detail={<ComparisonText comparisonLabel={comparisonLabel} currencyCode={currencyCode} current={summary.average_order_minor} format="currency" previous={previousSummary?.average_order_minor ?? null} />}
            help="The average completed sale amount before refunds."
            icon={ChartColumnBig}
            label="Average order"
            value={formatMinorMoney(summary.average_order_minor, currencyCode)}
          />
          <KpiCard
            detail={`${percentOf(summary.refunds_minor, summary.sales_total_minor)} of completed sales`}
            help="Money returned to customers during the selected period."
            icon={TrendingDown}
            label="Refunds"
            tone={summary.refunds_minor > 0 ? "negative" : "default"}
            value={formatMinorMoney(summary.refunds_minor, currencyCode)}
          />
          {operations.access.cost ? (
            <KpiCard
              detail={costComplete
                ? `${formatMinorMoney(summary.cogs_minor ?? 0, currencyCode)} COGS · ${summary.gross_margin_bps === null ? "—" : `${new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(summary.gross_margin_bps / 100)}%`} margin`
                : <Link className="font-medium text-primary hover:underline" href="/back-office/catalog">{operations.cost.missing_sales_cost_item_count ?? 0} sold {operations.cost.missing_sales_cost_item_count === 1 ? "item needs" : "items need"} cost information</Link>}
              help="Net sales less recorded product cost. It is withheld when any sold line has no cost information."
              icon={CircleDollarSign}
              label="Gross profit"
              tone={costComplete ? "positive" : "warning"}
              value={costComplete ? formatMinorMoney(summary.gross_profit_minor ?? 0, currencyCode) : "Cost data incomplete"}
            />
          ) : null}
        </div>
      </section>

      <NeedsAttention items={attentionItems} />

      {summary.transaction_count === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div><p className="font-semibold">No sales yet</p><p className="mt-1 text-sm text-muted-foreground">No completed sales were recorded in this period.</p></div>
            {permissions.includes("pos.access") ? <Button nativeButton={false} render={<Link href="/pos" />} variant="outline"><MonitorSmartphone /> Open POS</Button> : null}
          </CardContent>
        </Card>
      ) : null}

      <section className={cn("grid gap-4", showStorePerformance && "xl:grid-cols-2")}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle>Sales performance</CardTitle><CardDescription>Net sales by business day for this period.</CardDescription></div>
              <div className="text-right"><p className="text-xl font-semibold">{formatMinorMoney(summary.net_sales_minor, currencyCode)}</p><p className="text-xs text-muted-foreground"><ComparisonText comparisonLabel={comparisonLabel} currencyCode={currencyCode} current={summary.net_sales_minor} previous={previousSummary?.net_sales_minor ?? null} /></p></div>
            </div>
          </CardHeader>
          <CardContent>
            {salesByDay.length > 0 ? (
              <div aria-label={`Net sales trend totaling ${formatMinorMoney(summary.net_sales_minor, currencyCode)}`} className="h-60" role="img">
                <ResponsiveContainer height="100%" width="100%">
                  <AreaChart accessibilityLayer data={salesByDay} margin={{ bottom: 0, left: -18, right: 8, top: 8 }}>
                    <defs><linearGradient id="dashboardSalesFill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} /></linearGradient></defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis axisLine={false} dataKey="label" minTickGap={28} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickLine={false} />
                    <YAxis axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(value)} tickLine={false} />
                    <ChartTooltip contentStyle={{ borderColor: "var(--border)", borderRadius: "0.5rem" }} formatter={(value) => [formatMinorMoney(Number(Array.isArray(value) ? value[0] : value ?? 0) * 100, currencyCode), "Net sales"] as [string, string]} />
                    <Area dataKey="net" fill="url(#dashboardSalesFill)" stroke="var(--chart-1)" strokeWidth={2.5} type="monotone" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="grid h-60 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Sales will appear after a completed transaction.</p>}
          </CardContent>
        </Card>

        {showStorePerformance ? (
          <Card>
            <CardHeader><CardTitle>Store performance</CardTitle><CardDescription>True net sales after store refunds, ranked across active stores.</CardDescription></CardHeader>
            <CardContent>
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-120 text-left text-sm">
                  <thead className="border-b text-xs tracking-wide text-muted-foreground uppercase"><tr><th className="py-2 pr-3 font-medium">Store</th><th className="py-2 pr-3 text-right font-medium">Net sales</th><th className="py-2 pr-3 text-right font-medium">Transactions</th><th className="py-2 text-right font-medium">Avg order</th></tr></thead>
                  <tbody className="divide-y">
                    {operations.store_performance.map((store, index) => (
                      <tr key={store.store_id}>
                        <td className="py-3 pr-3 font-medium"><Link className="inline-flex items-center gap-2 text-primary hover:underline" href={`/back-office?${dashboardQuery}&store=${store.store_id}`}>{index + 1}. {store.name}</Link></td>
                        <td className="py-3 pr-3 text-right">{formatMinorMoney(store.net_sales_minor, currencyCode)}</td>
                        <td className="py-3 pr-3 text-right text-muted-foreground">{formatQuantity(store.transaction_count)}</td>
                        <td className="py-3 text-right text-muted-foreground">{formatMinorMoney(store.average_order_minor, currencyCode)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </section>

      {((features.shifts && operations.access.shifts)
        || (features.timeClock && operations.access.team)
        || operations.access.approvals
        || (features.deviceManagement && operations.access.devices)
        || (features.openTickets && operations.access.tickets)) ? (
        <section className="space-y-3">
          <SectionHeading eyebrow="Operations" title="Today’s operations" description="Live operational state for the selected store scope; these counts do not change with the sales period." />
          <Card><CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {features.shifts && operations.access.shifts && operations.operations.open_register_count !== null && operations.operations.active_register_count !== null ? <OperationLink href={shiftHref} label="Registers open" value={`${operations.operations.open_register_count} / ${operations.operations.active_register_count}`} /> : null}
            {features.shifts && operations.access.shifts && operations.operations.active_shift_count !== null ? <OperationLink href={shiftHref} label="Active shifts" value={formatQuantity(operations.operations.active_shift_count)} /> : null}
            {features.timeClock && operations.access.team && operations.operations.clocked_in_employee_count !== null ? <OperationLink href="/back-office/time-clock" label="Employees clocked in" value={formatQuantity(operations.operations.clocked_in_employee_count)} /> : null}
            {operations.access.approvals && operations.operations.pending_approval_count !== null ? <OperationLink href={securityHref} label="Pending approvals" value={formatQuantity(operations.operations.pending_approval_count)} /> : null}
            {features.deviceManagement && operations.access.devices && operations.operations.pending_sync_count !== null ? <OperationLink href={syncHref} label="Server-observed pending sync" value={formatQuantity(operations.operations.pending_sync_count)} /> : null}
            {features.deviceManagement && operations.access.devices && operations.operations.sync_issue_count !== null ? <OperationLink href={syncHref} label="Sync conflicts / failures" value={formatQuantity(operations.operations.sync_issue_count)} /> : null}
            {features.deviceManagement && operations.access.devices && operations.operations.devices_not_seen_recently_count !== null ? <OperationLink href={devicesHref} label="Devices not seen in 15m" value={formatQuantity(operations.operations.devices_not_seen_recently_count)} /> : null}
            {features.shifts && operations.access.shifts ? <OperationLink href={shiftHref} label="Cash differences in period" value={formatQuantity(current.security.cash_discrepancy_count)} /> : null}
            {features.openTickets && operations.access.tickets && operations.operations.open_ticket_count !== null ? <OperationLink href="/pos" label="Open tickets" value={formatQuantity(operations.operations.open_ticket_count)} /> : null}
          </CardContent></Card>
        </section>
      ) : null}

      <section className={cn("grid gap-4", features.inventory && operations.access.inventory && "xl:grid-cols-2")}>
        {features.inventory && operations.access.inventory ? (
          <Card>
            <CardHeader><CardTitle>Inventory health</CardTitle><CardDescription>Canonical stock positions in the selected store scope.</CardDescription></CardHeader>
            <CardContent className="space-y-5">
              {current.inventory.stock_item_count > 0 ? (
                <>
                  <div><p className="text-3xl font-semibold tracking-tight">{formatQuantity(current.inventory.on_hand_quantity)}</p><p className="text-sm text-muted-foreground">units on hand across {formatQuantity(current.inventory.stock_item_count)} tracked positions</p></div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <OperationLink href={`/back-office/inventory?tab=stock&status=low${inventorySuffix}`} label="Low stock" value={formatQuantity(operations.inventory.low_stock_count ?? 0)} />
                    <OperationLink href={`/back-office/inventory?tab=stock&status=out_of_stock${inventorySuffix}`} label="Out of stock" value={formatQuantity(operations.inventory.out_of_stock_count ?? 0)} />
                    <OperationLink href={`/back-office/inventory?tab=stock&status=negative${inventorySuffix}`} label="Negative" value={formatQuantity(operations.inventory.negative_stock_count ?? 0)} />
                  </div>
                  {operations.access.cost ? (
                    <div className="border-t pt-4"><p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Inventory value</p>{inventoryCostComplete ? <p className="mt-1 text-xl font-semibold">{formatMinorMoney(current.inventory.inventory_valuation_minor ?? 0, currencyCode)}</p> : <p className="mt-1 font-semibold text-amber-700 dark:text-amber-300">Cost data incomplete · {operations.cost.missing_inventory_cost_count} positions need cost information</p>}</div>
                  ) : null}
                </>
              ) : <div className="py-7 text-center"><p className="font-semibold">No tracked inventory yet</p><p className="mt-1 text-sm text-muted-foreground">Stock appears after products are configured for inventory.</p><Button className="mt-4" nativeButton={false} render={<Link href="/back-office/catalog" />} variant="outline">Manage products</Button></div>}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle>Top products</CardTitle><CardDescription>Ranked by net product sales after refunds.</CardDescription></div><Button nativeButton={false} render={<Link href={reportHref} />} size="sm" variant="ghost">View report <ArrowRight /></Button></CardHeader>
          <CardContent>
            {current.top_products.length > 0 ? (
              <div className="overflow-x-auto overscroll-x-contain">
                <table className="w-full min-w-105 text-left text-sm"><thead className="border-b text-xs tracking-wide text-muted-foreground uppercase"><tr><th className="py-2 pr-3 font-medium">#</th><th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 text-right font-medium">Qty</th><th className="py-2 text-right font-medium">Net sales</th></tr></thead><tbody className="divide-y">{current.top_products.slice(0, 6).map((product, index) => <tr key={`${product.product_id}:${product.variant_id ?? ""}`}><td className="py-3 pr-3 text-muted-foreground">{index + 1}</td><td className="max-w-72 whitespace-normal py-3 pr-3 font-medium">{product.name}</td><td className="py-3 pr-3 text-right text-muted-foreground">{formatQuantity(product.quantity_sold - product.quantity_refunded)}</td><td className="py-3 text-right">{formatMinorMoney(product.net_sales_minor, currencyCode)}</td></tr>)}</tbody></table>
              </div>
            ) : <p className="py-9 text-center text-sm text-muted-foreground">Products will appear after completed sales.</p>}
          </CardContent>
        </Card>
      </section>

      <section className={cn("grid gap-4", showPeople && "xl:grid-cols-2")}>
        <Card>
          <CardHeader><CardTitle>Payment mix</CardTitle><CardDescription>Captured payments, kept below sales and operational priorities.</CardDescription></CardHeader>
          <CardContent>
            {current.payments.length > 0 ? <div className="divide-y">{current.payments.slice(0, 6).map((payment) => <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 py-3 text-sm" key={`${payment.name}:${payment.type}`}><span className="min-w-0 break-words font-medium">{payment.name}</span><span className="text-muted-foreground">{percentOf(payment.amount_minor, paymentTotal)}</span><span className="text-right font-medium">{formatMinorMoney(payment.amount_minor, currencyCode)}</span></div>)}</div> : <p className="py-7 text-center text-sm text-muted-foreground">Payment methods will appear after completed sales.</p>}
          </CardContent>
        </Card>
        {showPeople ? <Card><CardHeader><CardTitle>Team & customers</CardTitle><CardDescription>Supported people signals for this authorized scope and period.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
          {operations.access.team ? <div className="rounded-lg border p-4"><p className="flex items-center gap-2 font-semibold"><Users aria-hidden="true" className="size-4 text-primary" /> Team</p><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Active team members</dt><dd className="font-medium">{operations.people.active_employee_count ?? 0}</dd></div>{features.timeClock ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Clocked in</dt><dd className="font-medium">{operations.operations.clocked_in_employee_count ?? 0}</dd></div> : null}{features.shifts ? <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Active shifts</dt><dd className="font-medium">{operations.operations.active_shift_count ?? 0}</dd></div> : null}</dl><Link className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary" href="/back-office/employees">View team <ArrowRight className="size-3.5" /></Link></div> : null}
          {operations.access.customers ? <div className="rounded-lg border p-4"><p className="flex items-center gap-2 font-semibold"><Users aria-hidden="true" className="size-4 text-primary" /> Customers</p><dl className="mt-3 space-y-2 text-sm"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Linked customers served</dt><dd className="font-medium">{operations.people.linked_customers_served ?? 0}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">New customers</dt><dd className="font-medium">{operations.people.new_customer_count ?? 0}</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Returning customers</dt><dd className="font-medium">{operations.people.returning_customer_count ?? 0}</dd></div></dl><Link className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary" href="/back-office/customers">View customers <ArrowRight className="size-3.5" /></Link></div> : null}
        </CardContent></Card> : null}
      </section>

      <section className="space-y-3" aria-labelledby="quick-actions-title">
        <SectionHeading description="Common setup and investigation destinations." eyebrow="Shortcuts" id="quick-actions-title" title="Quick actions" />
        <div className="flex flex-wrap gap-2">
          {permissions.includes("products.manage") ? <Button nativeButton={false} render={<Link href="/back-office/catalog" />} size="sm" variant="outline"><PackagePlus /> Product</Button> : null}
          {permissions.includes("employees.manage") ? <Button nativeButton={false} render={<Link href="/back-office/employees" />} size="sm" variant="outline"><UserPlus /> Employee</Button> : null}
          {permissions.includes("stores.manage") ? <Button nativeButton={false} render={<Link href="/back-office/stores" />} size="sm" variant="outline"><Store /> Store</Button> : null}
          {permissions.includes("reports.view") ? <Button nativeButton={false} render={<Link href={reportHref} />} size="sm" variant="outline"><ChartColumnBig /> View reports</Button> : null}
        </div>
      </section>
    </div>
  );
}
