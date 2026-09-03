"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartColumnBig,
  CircleDollarSign,
  ReceiptText,
  TrendingDown,
  TrendingUp,
  Warehouse,
} from "lucide-react";

import { ContextHelp } from "@/components/back-office/context-help";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { inventoryActivityLabel } from "@/features/inventory/inventory-activity-copy";
import type { ReportSnapshot } from "@/features/reports/reporting";

const chartColors = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 2 }).format(value);
}

function formatPercentage(basisPoints: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 1 }).format(basisPoints / 100) + "%";
}

function formatChartDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { month: "short", day: "numeric" }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function MetricCard({
  label,
  value,
  detail,
  help,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  help?: string;
  icon: typeof ChartColumnBig;
  tone?: "default" | "positive" | "negative";
}) {
  const toneClassName =
    tone === "positive"
      ? "bg-primary/10 text-primary"
      : tone === "negative"
        ? "bg-destructive/10 text-destructive"
        : "bg-secondary text-secondary-foreground";

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <p className="flex items-center gap-1 text-sm text-muted-foreground">
          {label}
          {help ? <ContextHelp label={`What is ${label}?`}>{help}</ContextHelp> : null}
        </p>
        <span className={`grid size-9 place-items-center rounded-lg ${toneClassName}`}>
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-[-0.04em]">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="grid h-64 place-items-center rounded-lg border border-dashed bg-muted/30 px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function SectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h2 className="font-heading text-lg font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

type ReportPrintContext = {
  organizationName: string;
  storeName: string;
  startDate: string;
  endDate: string;
  timezone: string;
};

function formatPrintDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeZone: timezone,
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function ReportPrintTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: string[][];
}) {
  return (
    <table data-report-print-table>
      <thead>
        <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row[0]}-${index}`}>
            {row.map((value, valueIndex) => <td key={`${value}-${valueIndex}`}>{value}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReportPrintDocument({
  context,
  currencyCode,
  snapshot,
}: {
  context: ReportPrintContext;
  currencyCode: string;
  snapshot: ReportSnapshot;
}) {
  const { summary } = snapshot;
  const dateRange = `${formatPrintDate(context.startDate, context.timezone)} – ${formatPrintDate(context.endDate, context.timezone)}`;
  const paymentRows = snapshot.payments.map((payment) => [
    payment.name,
    payment.type,
    formatQuantity(payment.payment_count),
    formatMinorMoney(payment.amount_minor, currencyCode),
  ]);
  const storeRows = snapshot.sales_by_store.map((store) => [
    store.name,
    formatQuantity(store.transaction_count),
    formatMinorMoney(store.sales_minor, currencyCode),
  ]);
  const productRows = snapshot.top_products.slice(0, 12).map((product) => [
    product.name,
    formatQuantity(product.quantity_sold),
    formatMinorMoney(product.net_sales_minor, currencyCode),
  ]);
  const employeeRows = snapshot.sales_by_employee.slice(0, 12).map((employee) => [
    employee.name,
    formatQuantity(employee.transaction_count),
    formatMinorMoney(employee.sales_minor, currencyCode),
  ]);

  return (
    <article className="hidden" data-report-print-document>
      <header data-report-print-header>
        <p>TINDIO</p>
        <h1>Business summary</h1>
        <dl>
          <div><dt>Business</dt><dd>{context.organizationName}</dd></div>
          <div><dt>Store scope</dt><dd>{context.storeName}</dd></div>
          <div><dt>Date range</dt><dd>{dateRange}</dd></div>
        </dl>
      </header>

      <section data-report-print-section>
        <h2>Sales summary</h2>
        <dl data-report-print-totals>
          <div><dt>Gross sales</dt><dd>{formatMinorMoney(summary.gross_sales_minor, currencyCode)}</dd></div>
          <div><dt>Completed sales</dt><dd>{formatMinorMoney(summary.sales_total_minor, currencyCode)}</dd></div>
          <div><dt>Refunds</dt><dd>{formatMinorMoney(summary.refunds_minor, currencyCode)}</dd></div>
          <div><dt>Discounts</dt><dd>{formatMinorMoney(summary.discounts_minor, currencyCode)}</dd></div>
          <div><dt>Net sales</dt><dd>{formatMinorMoney(summary.net_sales_minor, currencyCode)}</dd></div>
          <div><dt>Transactions</dt><dd>{formatQuantity(summary.transaction_count)}</dd></div>
        </dl>
      </section>

      <section data-report-print-section>
        <h2>Payment summary</h2>
        {paymentRows.length > 0 ? <ReportPrintTable columns={["Method", "Type", "Payments", "Amount"]} rows={paymentRows} /> : <p>No captured payments in this period.</p>}
      </section>

      <section data-report-print-section>
        <h2>Store performance</h2>
        {storeRows.length > 0 ? <ReportPrintTable columns={["Store", "Transactions", "Sales"]} rows={storeRows} /> : <p>No completed sales in this period.</p>}
      </section>

      <section data-report-print-section>
        <h2>Top products</h2>
        {productRows.length > 0 ? <ReportPrintTable columns={["Product", "Units sold", "Net sales"]} rows={productRows} /> : <p>No products were sold in this period.</p>}
      </section>

      <section data-report-print-section>
        <h2>Employee performance</h2>
        {employeeRows.length > 0 ? <ReportPrintTable columns={["Employee", "Transactions", "Sales"]} rows={employeeRows} /> : <p>No employee sales in this period.</p>}
      </section>

      <section data-report-print-section>
        <h2>Inventory health</h2>
        <dl data-report-print-totals>
          <div><dt>Tracked stock positions</dt><dd>{formatQuantity(snapshot.inventory.stock_item_count)}</dd></div>
          <div><dt>Units on hand</dt><dd>{formatQuantity(snapshot.inventory.on_hand_quantity)}</dd></div>
          <div><dt>Low stock</dt><dd>{formatQuantity(snapshot.inventory.low_stock_count)}</dd></div>
          <div><dt>Out of stock</dt><dd>{formatQuantity(snapshot.inventory.out_of_stock_count)}</dd></div>
        </dl>
      </section>
    </article>
  );
}

export function ReportingOverview({
  snapshot,
  currencyCode,
  mode,
  printContext,
}: {
  snapshot: ReportSnapshot;
  currencyCode: string;
  mode: "dashboard" | "reports";
  printContext?: ReportPrintContext;
}) {
  const { summary } = snapshot;
  const salesByDay = snapshot.sales_by_day.map((day) => ({
    ...day,
    label: formatChartDate(day.date),
    net: day.net_sales_minor / 100,
  }));
  const paymentData = snapshot.payments.map((payment) => ({
    ...payment,
    value: payment.amount_minor / 100,
  }));
  const topProductData = snapshot.top_products.slice(0, 6).map((product) => ({
    ...product,
    label: product.name.length > 22 ? `${product.name.slice(0, 21)}…` : product.name,
    net: product.net_sales_minor / 100,
  }));
  const unitName = currencyCode.toUpperCase();
  return (
    <>
    <div className="space-y-8" data-report-screen>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Report summary">
        <MetricCard
          detail={`${summary.transaction_count} completed transaction${summary.transaction_count === 1 ? "" : "s"}`}
          help="Completed sales minus recorded refunds for the selected date range."
          icon={TrendingUp}
          label="Net sales"
          tone="positive"
          value={formatMinorMoney(summary.net_sales_minor, currencyCode)}
        />
        <MetricCard
          detail={`${formatMinorMoney(summary.discounts_minor, currencyCode)} in discounts`}
          help="The total before refunds for completed transactions in this period."
          icon={CircleDollarSign}
          label="Completed sales"
          value={formatMinorMoney(summary.sales_total_minor, currencyCode)}
        />
        <MetricCard
          detail="Recorded returns in this period"
          help="Money returned to customers from completed sales."
          icon={TrendingDown}
          label="Refunds"
          tone="negative"
          value={formatMinorMoney(summary.refunds_minor, currencyCode)}
        />
        <MetricCard
          detail={`${formatMinorMoney(summary.taxes_minor, currencyCode)} taxes included`}
          help="The average completed sale amount in the selected period."
          icon={ReceiptText}
          label="Average order"
          value={formatMinorMoney(summary.average_order_minor, currencyCode)}
        />
      </section>

      {summary.cost_access ? (
        <section className="grid gap-4 sm:grid-cols-3" aria-label="Profit summary">
          <MetricCard
            detail="Recorded cost of the products sold"
            help="Product cost, also called cost of goods sold (COGS), is the cost recorded when products are sold."
            icon={Warehouse}
            label="Product cost (COGS)"
            value={formatMinorMoney(summary.cogs_minor ?? 0, currencyCode)}
          />
          <MetricCard
            detail="Net sales less recorded product cost"
            help="The sales amount left after subtracting the recorded cost of products sold."
            icon={TrendingUp}
            label="Gross profit"
            tone={(summary.gross_profit_minor ?? 0) < 0 ? "negative" : "positive"}
            value={formatMinorMoney(summary.gross_profit_minor ?? 0, currencyCode)}
          />
          <MetricCard
            detail="Gross profit as a share of net sales"
            help="The percentage of net sales left after product cost is subtracted."
            icon={ChartColumnBig}
            label="Gross margin"
            value={summary.gross_margin_bps === null ? "—" : formatPercentage(summary.gross_margin_bps)}
          />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Net sales trend</CardTitle>
            <CardDescription>Completed sales less recorded refunds, by business day.</CardDescription>
          </CardHeader>
          <CardContent>
            {salesByDay.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer height="100%" width="100%">
                  <AreaChart data={salesByDay} margin={{ bottom: 0, left: -18, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="netSalesFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      axisLine={false}
                      dataKey="label"
                      minTickGap={28}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickLine={false}
                    />
                    <YAxis
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickFormatter={(value: number) => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(value)}
                      tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ borderColor: "var(--border)", borderRadius: "0.5rem" }}
                      formatter={(value) => [
                        formatMinorMoney(Number(Array.isArray(value) ? value[0] : value ?? 0) * 100, currencyCode),
                        "Net sales",
                      ] as [string, string]}
                    />
                    <Area
                      dataKey="net"
                      fill="url(#netSalesFill)"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      type="monotone"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message="Completed sales in this date range will appear here." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment mix</CardTitle>
            <CardDescription>Captured payment amounts by method.</CardDescription>
          </CardHeader>
          <CardContent>
            {paymentData.length > 0 ? (
              <div className="h-64">
                <ResponsiveContainer height="100%" width="100%">
                  <PieChart>
                    <Pie
                      cx="50%"
                      cy="47%"
                      data={paymentData}
                      dataKey="value"
                      innerRadius={56}
                      outerRadius={83}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {paymentData.map((payment, index) => (
                        <Cell fill={chartColors[index % chartColors.length]} key={payment.name} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ borderColor: "var(--border)", borderRadius: "0.5rem" }}
                      formatter={(value) => formatMinorMoney(Number(Array.isArray(value) ? value[0] : value ?? 0) * 100, currencyCode)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message="Payment methods will appear after completed sales." />
            )}
            {paymentData.length > 0 ? (
              <div className="mt-1 grid gap-2">
                {paymentData.slice(0, 4).map((payment, index) => (
                  <div className="flex items-center justify-between gap-3 text-sm" key={`${payment.name}-${payment.type}`}>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: chartColors[index % chartColors.length] }} />
                      <span className="truncate">{payment.name}</span>
                    </span>
                    <span className="font-medium">{formatMinorMoney(payment.amount_minor, currencyCode)}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(20rem,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <CardDescription>Net product sales from completed transactions.</CardDescription>
          </CardHeader>
          <CardContent>
            {topProductData.length > 0 ? (
              <div className="h-72">
                <ResponsiveContainer height="100%" width="100%">
                  <BarChart data={topProductData} layout="vertical" margin={{ bottom: 0, left: 12, right: 8, top: 0 }}>
                    <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      axisLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickFormatter={(value: number) => new Intl.NumberFormat("en-PH", { maximumFractionDigits: 0 }).format(value)}
                      tickLine={false}
                      type="number"
                    />
                    <YAxis
                      axisLine={false}
                      dataKey="label"
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickLine={false}
                      type="category"
                      width={105}
                    />
                    <Tooltip
                      contentStyle={{ borderColor: "var(--border)", borderRadius: "0.5rem" }}
                      formatter={(value) => [
                        formatMinorMoney(Number(Array.isArray(value) ? value[0] : value ?? 0) * 100, currencyCode),
                        "Net sales",
                      ] as [string, string]}
                    />
                    <Bar dataKey="net" fill="var(--chart-2)" radius={[0, 5, 5, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyChart message="Products sold in this date range will appear here." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profit & stock snapshot</CardTitle>
            <CardDescription>Cost-sensitive figures are shown only to authorized roles.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                <Warehouse aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="font-medium">{formatQuantity(snapshot.inventory.on_hand_quantity)} units on hand</p>
                <p className="text-sm text-muted-foreground">Across {formatQuantity(snapshot.inventory.stock_item_count)} tracked stock positions</p>
              </div>
            </div>
            {summary.cost_access ? (
              <div className="grid gap-4 border-t pt-5 sm:grid-cols-2 xl:grid-cols-1">
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Recorded gross profit</p>
                  <p className="mt-1 text-xl font-semibold">{formatMinorMoney(summary.gross_profit_minor ?? 0, currencyCode)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Inventory valuation</p>
                  <p className="mt-1 text-xl font-semibold">{formatMinorMoney(snapshot.inventory.inventory_valuation_minor ?? 0, currencyCode)}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                Ask an owner to give you access to product costs if you need to review profit and inventory value. You can still review sales and stock quantities.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {mode === "reports" ? (
        <section className="space-y-5">
          <SectionTitle
            description={`Compare the teams, stores, categories, and stock activity behind the headline figures. This screen uses ${unitName}.`}
            title="Operational breakdown"
          />
          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownCard
              columns={["Category", "Items sold", "Sales"]}
              empty="No category sales in this period."
              rows={snapshot.sales_by_category.map((category) => [
                category.name,
                formatQuantity(category.quantity_sold),
                formatMinorMoney(category.sales_minor, currencyCode),
              ])}
              title="Sales by category"
            />
            <BreakdownCard
              columns={["Employee", "Transactions", "Sales"]}
              empty="No employee sales in this period."
              rows={snapshot.sales_by_employee.map((employee) => [
                employee.name,
                formatQuantity(employee.transaction_count),
                formatMinorMoney(employee.sales_minor, currencyCode),
              ])}
              title="Employee performance"
            />
            <BreakdownCard
              columns={["Store", "Transactions", "Sales"]}
              empty="No store sales in this period."
              rows={snapshot.sales_by_store.map((store) => [
                store.name,
                formatQuantity(store.transaction_count),
                formatMinorMoney(store.sales_minor, currencyCode),
              ])}
              title="Store performance"
            />
            <BreakdownCard
              columns={["Register", "Transactions", "Sales"]}
              empty="No register sales in this period."
              rows={snapshot.sales_by_register.map((register) => [
                register.name,
                formatQuantity(register.transaction_count),
                formatMinorMoney(register.sales_minor, currencyCode),
              ])}
              title="Register performance"
            />
            <BreakdownCard
              columns={["Customer", "Transactions", "Sales"]}
              empty="No customer-linked sales in this period."
              rows={snapshot.sales_by_customer.map((customer) => [
                customer.name,
                formatQuantity(customer.transaction_count),
                formatMinorMoney(customer.sales_minor, currencyCode),
              ])}
              title="Customer spend"
            />
            <BreakdownCard
              columns={["Hour", "Transactions", "Sales"]}
              empty="No completed sales in this period."
              rows={snapshot.sales_by_hour.map((hour) => [
                hour.label,
                formatQuantity(hour.transaction_count),
                formatMinorMoney(hour.sales_minor, currencyCode),
              ])}
              title="Sales by hour"
            />
            <BreakdownCard
              columns={["Stock activity", "Records", "Quantity change"]}
              empty="No inventory movements in this period."
              rows={snapshot.inventory.movement_by_type.map((movement) => [
                inventoryActivityLabel(movement.movement_type),
                formatQuantity(movement.movement_count),
                formatQuantity(movement.quantity_delta),
              ])}
              title="Inventory movement"
            />
          </div>

          <SectionTitle
            description="Current inventory position, recent sale velocity, and stock activity for the selected stores."
            title="Inventory health"
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard detail="At or below their configured threshold" icon={TrendingDown} label="Low stock" tone="negative" value={formatQuantity(snapshot.inventory.low_stock_count)} />
            <MetricCard detail="Tracked positions with no units" icon={Warehouse} label="Out of stock" tone="negative" value={formatQuantity(snapshot.inventory.out_of_stock_count)} />
            <MetricCard detail="Positions below zero need attention" icon={TrendingDown} label="Negative stock" tone="negative" value={formatQuantity(snapshot.inventory.negative_stock_count)} />
            <MetricCard detail="On hand without a sale in 90 days" icon={TrendingDown} label="Dead stock" value={formatQuantity(snapshot.inventory.dead_stock_count)} />
            <MetricCard detail={`${snapshot.inventory.activity.purchase_receipt_count} receipts · ${snapshot.inventory.activity.transfer_count} transfers`} icon={Warehouse} label="Manual changes" value={formatQuantity(snapshot.inventory.activity.manual_adjustment_count)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownCard
              columns={["Item", "Units sold", "Net sales"]}
              empty="Fast-moving products will appear after completed sales."
              rows={snapshot.inventory.fast_movers.map((product) => [
                product.name,
                formatQuantity(product.quantity_sold),
                formatMinorMoney(product.net_sales_minor, currencyCode),
              ])}
              title="Fast movers"
            />
            <BreakdownCard
              columns={["Item", "On hand", "Units sold"]}
              empty="Slow-moving stocked items will appear here."
              rows={snapshot.inventory.slow_movers.map((product) => [
                product.name,
                formatQuantity(product.quantity_on_hand),
                formatQuantity(product.quantity_sold),
              ])}
              title="Slow movers"
            />
          </div>

          <SectionTitle
            description="Accountability indicators are derived from refunds, approval audits, shift closures, and inventory movement records."
            title="Security & accountability"
          />
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard detail={`${snapshot.security.refund_count} refund${snapshot.security.refund_count === 1 ? "" : "s"} · ${snapshot.security.void_count} void${snapshot.security.void_count === 1 ? "" : "s"}`} icon={TrendingDown} label="Refunds & voids" tone="negative" value={formatMinorMoney(summary.refunds_minor, currencyCode)} />
            <MetricCard detail={`${snapshot.security.high_discount_count} high discount${snapshot.security.high_discount_count === 1 ? "" : "s"} · ${snapshot.security.price_override_count} override${snapshot.security.price_override_count === 1 ? "" : "s"}`} icon={ReceiptText} label="Discount controls" value={formatQuantity(snapshot.security.manager_approval_count)} />
            <MetricCard detail={`${formatQuantity(snapshot.security.cash_discrepancy_count)} closed shift${snapshot.security.cash_discrepancy_count === 1 ? "" : "s"} with a difference`} icon={CircleDollarSign} label="Cash discrepancy" tone={snapshot.security.cash_discrepancy_absolute_minor > 0 ? "negative" : "default"} value={formatMinorMoney(snapshot.security.cash_discrepancy_absolute_minor, currencyCode)} />
            <MetricCard detail="Manual adjustments, damage, loss, and counts" icon={Warehouse} label="Inventory changes" value={formatQuantity(snapshot.security.manual_inventory_change_count)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownCard
              columns={["Audit event", "Records"]}
              empty="No security-relevant audit records in this period."
              rows={snapshot.security.events.map((event) => [
                event.event_type.replaceAll("_", " "),
                formatQuantity(event.event_count),
              ])}
              title="Audit events"
            />
          </div>
        </section>
      ) : null}
    </div>
    {printContext ? <ReportPrintDocument context={printContext} currencyCode={currencyCode} snapshot={snapshot} /> : null}
    </>
  );
}

function BreakdownCard({
  title,
  columns,
  rows,
  empty,
}: {
  title: string;
  columns: string[];
  rows: string[][];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <div className="overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[29rem] text-left text-sm">
              <thead className="border-b text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  {columns.map((column) => <th className="px-0 py-2 pr-4 font-medium" key={column}>{column}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row, index) => (
                  <tr key={`${row[0]}-${index}`}>
                    {row.map((value, valueIndex) => (
                      <td className={valueIndex === 0 ? "py-3 pr-4 font-medium capitalize" : "py-3 pr-4 text-muted-foreground"} key={`${value}-${valueIndex}`}>
                        {value}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-7 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}
