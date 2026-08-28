import Link from "next/link";
import { ArrowLeft, ArrowDownToLine, ArrowUpFromLine, ClipboardList, ReceiptText, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import type { ShiftAuditReport } from "@/features/shifts/data";
import { ShiftClosePrintButton, type ShiftOperationalSummary } from "@/features/shifts/shift-manager";

function formatShiftAuditTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function AmountRow({
  currencyCode,
  label,
  value,
}: {
  currencyCode: string;
  label: string;
  value: number;
}) {
  return <div className="flex items-center justify-between gap-4 text-sm"><span className="text-muted-foreground">{label}</span><strong>{formatMinorMoney(value, currencyCode)}</strong></div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 border-b py-3 last:border-b-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"><span className="text-sm text-muted-foreground">{label}</span><span className="min-w-0 break-words text-sm font-medium">{value}</span></div>;
}

export function ShiftAuditReportView({
  currencyCode,
  report,
  timezone,
}: {
  currencyCode: string;
  report: ShiftAuditReport;
  timezone: string;
}) {
  const operationalSummary: ShiftOperationalSummary = {
    shift: {
      id: report.shift.id,
      number: report.shift.number,
      status: "closed",
      openedBy: report.shift.openedBy,
      openedAt: report.shift.openedAt,
      closedAt: report.shift.closedAt,
      store: report.shift.store,
      register: report.shift.register,
      startingCashMinor: report.shift.openingCashMinor,
      actualCashMinor: report.shift.countedCashMinor,
      differenceMinor: report.shift.differenceMinor,
    },
    cash: {
      cashPaymentsMinor: report.cash.cashPaymentsMinor,
      cashRefundsMinor: report.cash.cashRefundsMinor,
      paidInMinor: report.cash.paidInMinor,
      paidOutMinor: report.cash.paidOutMinor,
      expectedCashMinor: report.shift.expectedCashMinor,
    },
    sales: {
      grossSalesMinor: report.sales.grossSalesMinor,
      refundsMinor: report.sales.refundsMinor,
      discountsMinor: report.sales.discountsMinor,
      netSalesMinor: report.sales.netSalesMinor,
    },
  };
  const differenceLabel = report.shift.differenceMinor === 0
    ? "Balanced"
    : report.shift.differenceMinor > 0
      ? "Over"
      : "Short";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground" href="/back-office/shifts">
            <ArrowLeft aria-hidden="true" className="size-4" /> Shift reports
          </Link>
          <p className="mt-4 text-xs font-semibold tracking-[0.12em] text-primary uppercase">Shift-close audit</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">{report.shift.number}</h1>
          <p className="mt-2 text-sm text-muted-foreground">Immutable close record for {report.shift.register} at {report.shift.store}.</p>
        </div>
        <ShiftClosePrintButton
          closedAt={report.shift.closedAt}
          countedCashMinor={report.shift.countedCashMinor}
          currencyCode={currencyCode}
          differenceMinor={report.shift.differenceMinor}
          expectedCashMinor={report.shift.expectedCashMinor}
          openedAt={report.shift.openedAt}
          operationalSummary={operationalSummary}
          registerName={report.shift.register}
          shiftId={report.shift.id}
          storeName={report.shift.store}
          timezone={timezone}
        />
      </div>

      <section className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><ClipboardList className="size-5" /></span>
            <div><CardTitle>Shift record</CardTitle><p className="mt-1 text-sm text-muted-foreground">Register, employee, and recorded opening/close details.</p></div>
          </CardHeader>
          <CardContent>
            <DetailRow label="Store / register" value={`${report.shift.store} / ${report.shift.register}`} />
            <DetailRow label="Opened by" value={`${report.shift.openedBy} · ${formatShiftAuditTime(report.shift.openedAt, timezone)}`} />
            <DetailRow label="Closed by" value={`${report.shift.closedBy} · ${formatShiftAuditTime(report.shift.closedAt, timezone)}`} />
            <DetailRow label="Opening note" value={report.shift.openingNote || "No opening note recorded."} />
            <DetailRow label="Closing remarks" value={report.shift.closingNote || "No closing remarks recorded."} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Cash reconciliation</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <AmountRow currencyCode={currencyCode} label="Opening cash" value={report.shift.openingCashMinor} />
            <AmountRow currencyCode={currencyCode} label="Cash payments" value={report.cash.cashPaymentsMinor} />
            <AmountRow currencyCode={currencyCode} label="Cash refunds" value={-report.cash.cashRefundsMinor} />
            <AmountRow currencyCode={currencyCode} label="Paid in" value={report.cash.paidInMinor} />
            <AmountRow currencyCode={currencyCode} label="Paid out" value={-report.cash.paidOutMinor} />
            <div className="border-t pt-3"><AmountRow currencyCode={currencyCode} label="Expected cash" value={report.shift.expectedCashMinor} /></div>
            <AmountRow currencyCode={currencyCode} label="Counted cash" value={report.shift.countedCashMinor} />
            <div className="flex items-center justify-between gap-4 border-t pt-3 text-sm"><span className="text-muted-foreground">{differenceLabel}</span><strong className={report.shift.differenceMinor === 0 ? "" : report.shift.differenceMinor > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}>{report.shift.differenceMinor > 0 ? "+" : ""}{formatMinorMoney(report.shift.differenceMinor, currencyCode)}</strong></div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><ReceiptText className="size-5" /></span><div><CardTitle>Sales totals</CardTitle><p className="mt-1 text-sm text-muted-foreground">{report.sales.saleCount} completed sale{report.sales.saleCount === 1 ? "" : "s"} and {report.sales.refundCount} refund{report.sales.refundCount === 1 ? "" : "s"}.</p></div></CardHeader>
          <CardContent className="space-y-3">
            <AmountRow currencyCode={currencyCode} label="Gross sales" value={report.sales.grossSalesMinor} />
            <AmountRow currencyCode={currencyCode} label="Discounts" value={-report.sales.discountsMinor} />
            <AmountRow currencyCode={currencyCode} label="Tax" value={report.sales.taxMinor} />
            <AmountRow currencyCode={currencyCode} label="Sales total" value={report.sales.salesTotalMinor} />
            <AmountRow currencyCode={currencyCode} label="Refunds" value={-report.sales.refundsMinor} />
            <div className="border-t pt-3"><AmountRow currencyCode={currencyCode} label="Net sales" value={report.sales.netSalesMinor} /></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment breakdown</CardTitle></CardHeader>
          <CardContent>
            {report.paymentBreakdown.length > 0 ? <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-150 text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Method</th><th className="px-3 py-2 text-right font-medium">Collected</th><th className="px-3 py-2 text-right font-medium">Refunded</th><th className="px-3 py-2 text-right font-medium">Net</th></tr></thead><tbody className="divide-y">{report.paymentBreakdown.map((payment) => <tr key={`${payment.name}:${payment.type}`}><td className="px-3 py-3"><p className="font-medium">{payment.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{payment.type}</p></td><td className="px-3 py-3 text-right">{formatMinorMoney(payment.salesMinor, currencyCode)}</td><td className="px-3 py-3 text-right">{payment.refundsMinor ? `-${formatMinorMoney(payment.refundsMinor, currencyCode)}` : "—"}</td><td className="px-3 py-3 text-right font-medium">{formatMinorMoney(payment.netMinor, currencyCode)}</td></tr>)}</tbody></table></div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No recorded payments are linked to this shift.</p>}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><WalletCards className="size-5" /></span><div><CardTitle>Cash movements</CardTitle><p className="mt-1 text-sm text-muted-foreground">Authoritative pay-ins and pay-outs retained with their reason and employee.</p></div></CardHeader>
          <CardContent>
            {report.cashMovements.length > 0 ? <div className="divide-y rounded-lg border">{report.cashMovements.map((movement) => <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between" key={movement.id}><div><div className="flex items-center gap-2"><Badge variant={movement.type === "PAY_IN" ? "secondary" : "outline"}>{movement.type === "PAY_IN" ? <ArrowDownToLine /> : <ArrowUpFromLine />}{movement.type === "PAY_IN" ? "Pay in" : "Pay out"}</Badge><span className="text-xs text-muted-foreground">{formatShiftAuditTime(movement.createdAt, timezone)}</span></div><p className="mt-2 text-sm">{movement.reason}</p><p className="mt-1 text-xs text-muted-foreground">{movement.employee}</p></div><strong>{movement.type === "PAY_IN" ? "+" : "-"}{formatMinorMoney(movement.amountMinor, currencyCode)}</strong></div>)}</div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No pay-in or pay-out was recorded for this shift.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit history</CardTitle><p className="mt-1 text-sm text-muted-foreground">Lifecycle entries use the immutable shift record. Related logged events are shown only to roles with audit access.</p></CardHeader>
          <CardContent className="space-y-4">
            <div className="divide-y rounded-lg border">{report.audit.lifecycle.map((event) => <div className="p-3" key={event.eventType}><div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="secondary">{event.eventType === "SHIFT_OPENED" ? "Shift opened" : "Shift closed"}</Badge><span className="text-xs text-muted-foreground">{formatShiftAuditTime(event.createdAt, timezone)}</span></div><p className="mt-2 text-sm">{event.actor}</p>{event.reason ? <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p> : null}</div>)}</div>
            {report.audit.available ? report.audit.events.length > 0 ? <div className="divide-y rounded-lg border">{report.audit.events.map((event) => <div className="p-3" key={event.id}><div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{event.eventType}</Badge><span className="text-xs text-muted-foreground">{formatShiftAuditTime(event.createdAt, timezone)}</span></div><p className="mt-2 text-sm">{event.actor}{event.operationCode ? ` · ${event.operationCode}` : ""}</p>{event.reason ? <p className="mt-1 text-xs text-muted-foreground">{event.reason}</p> : null}{event.amountMinor !== null ? <p className="mt-1 text-xs font-medium">{formatMinorMoney(event.amountMinor, currencyCode)}</p> : null}</div>)}</div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No additional audit events are linked to this shift.</p> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Your role can view the shift report, but `audit.view` is required to view related audit-log events.</p>}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
