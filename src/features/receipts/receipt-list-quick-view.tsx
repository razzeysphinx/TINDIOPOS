"use client";

import { ArrowLeft, AtSign, RotateCcw } from "lucide-react";
import { useRef, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { BackOfficeDetailDrawer } from "@/components/back-office/back-office-detail-drawer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { loadReceiptQuickViewAction } from "@/features/receipts/quick-view/actions";
import type { ReceiptDetailData, ReceiptRefundStatus } from "@/features/receipts/detail/data";
import { ReceiptDeliveryForm } from "@/features/receipts/receipt-delivery-form";
import { ReceiptDocument } from "@/features/receipts/receipt-document";
import { ReceiptPrintButton } from "@/features/receipts/receipt-print-button";
import { RefundForm, type ReceiptRefundWorkflowMode } from "@/features/receipts/refund-form";

export type ReceiptListQuickViewItem = {
  canRefund: boolean;
  cashierName: string;
  currencyCode: string;
  fullReceiptHref: string;
  id: string;
  issuedAt: string;
  number: number;
  paymentNames: string[];
  refundStatus: Exclude<ReceiptRefundStatus, "completed"> | "available";
  registerName: string;
  storeName: string;
  totalMinor: number | null;
};

export type ReceiptListQuickViewGroup = {
  items: ReceiptListQuickViewItem[];
  storeName: string | null;
};

function formatReceiptDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function receiptStatusLabel(status: ReceiptRefundStatus) {
  if (status === "refunded") return "Refunded";
  if (status === "partially-refunded") return "Partially refunded";
  return "Completed";
}

function receiptStatusVariant(status: ReceiptRefundStatus) {
  return status === "completed" ? "secondary" : status === "refunded" ? "outline" : "secondary";
}

function paymentSummary(paymentNames: string[]) {
  const names = [...new Set(paymentNames.filter(Boolean))];
  if (names.length === 0) return "—";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

export function ReceiptListQuickView({
  groups,
  timezone,
}: {
  groups: ReceiptListQuickViewGroup[];
  timezone: string;
}) {
  const [detail, setDetail] = useState<ReceiptDetailData | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLoading, startLoadingTransition] = useTransition();
  const [loadError, setLoadError] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<string | null>(null);
  const [isDigitalReceiptOpen, setIsDigitalReceiptOpen] = useState(false);
  const [digitalReceiptNotice, setDigitalReceiptNotice] = useState<string | null>(null);
  const [drawerMode, setDrawerMode] = useState<"receipt" | ReceiptRefundWorkflowMode>("receipt");
  const requestId = useRef(0);
  const digitalReceiptButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusedReceiptTargetId = useRef<string | null>(null);

  const openReceipt = (receiptId: string, focusTargetId = `receipt-open-${receiptId}`) => {
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    lastFocusedReceiptTargetId.current = focusTargetId;
    setSelectedReceiptId(receiptId);
    setDetail(null);
    setDrawerMode("receipt");
    setLoadError(false);
    setIsDigitalReceiptOpen(false);
    setDigitalReceiptNotice(null);
    setIsDrawerOpen(true);

    startLoadingTransition(async () => {
      const result = await loadReceiptQuickViewAction({ receiptId });
      if (requestId.current !== currentRequest) return;
      if (!result.ok || !result.data) {
        setLoadError(true);
        return;
      }
      setDetail(result.data);
    });
  };

  const closeDrawer = () => {
    requestId.current += 1;
    setIsDrawerOpen(false);
    setIsDigitalReceiptOpen(false);
    setDigitalReceiptNotice(null);
    setLoadError(false);
    setDetail(null);
    setDrawerMode("receipt");
    const focusTargetId = lastFocusedReceiptTargetId.current;
    if (focusTargetId) {
      window.requestAnimationFrame(() => document.getElementById(focusTargetId)?.focus());
    }
  };

  const closeDigitalReceipt = () => {
    setIsDigitalReceiptOpen(false);
    window.requestAnimationFrame(() => digitalReceiptButtonRef.current?.focus());
  };

  const returnToUpdatedReceipt = () => {
    if (!selectedReceiptId) return;
    openReceipt(
      selectedReceiptId,
      lastFocusedReceiptTargetId.current ?? `receipt-open-${selectedReceiptId}`,
    );
  };

  return (
    <>
      <div className="hidden overflow-x-auto overscroll-x-contain rounded-lg border md:block">
          <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
            <colgroup><col className="w-48" /><col className="w-[8.5rem]" /><col className="w-44" /><col /><col className="w-32" /></colgroup>
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Reference</th>
                <th className="px-4 py-3 font-medium">Register</th>
                <th className="px-4 py-3 font-medium">Cashier</th>
                <th className="px-4 py-3 font-medium">Payment</th>
                <th className="px-4 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            {groups.map((group) => (
              <tbody className="divide-y" key={group.storeName ?? "all"}>
                {group.storeName ? (
                  <tr className="bg-muted/20">
                    <th className="px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase" colSpan={5}>
                      {group.storeName}
                    </th>
                  </tr>
                ) : null}
                {group.items.map((receipt) => {
                  return (
                    <tr
                      aria-label={`View receipt #${receipt.number}`}
                      className="cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                      id={`receipt-open-${receipt.id}`}
                      key={receipt.id}
                      onClick={() => openReceipt(receipt.id)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        openReceipt(receipt.id);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <td className="px-4 py-3">
                        <p className="font-mono font-semibold text-primary">#{receipt.number}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{formatReceiptDate(receipt.issuedAt, timezone)}</p>
                        {receipt.refundStatus !== "available" ? <Badge className="mt-1" variant={receipt.refundStatus === "refunded" ? "outline" : "secondary"}><RotateCcw aria-hidden="true" />{receipt.refundStatus === "refunded" ? "Refunded" : "Partially refunded"}</Badge> : null}
                      </td>
                      <td className="px-4 py-3 align-top"><p className="font-medium">{receipt.storeName} · {receipt.registerName}</p></td>
                      <td className="px-4 py-3 align-top text-muted-foreground">{receipt.cashierName}</td>
                      <td className="px-4 py-3 align-top text-muted-foreground"><span aria-label={receipt.paymentNames.length > 0 ? `Payment methods: ${receipt.paymentNames.join(", ")}` : "No payment method recorded"} title={receipt.paymentNames.join(", ") || undefined}>{paymentSummary(receipt.paymentNames)}</span></td>
                      <td className="px-4 py-3 text-right align-top font-semibold tabular-nums">{receipt.totalMinor === null ? "—" : formatMinorMoney(receipt.totalMinor, receipt.currencyCode)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
      </div>

      <div className="space-y-2 md:hidden">
        {groups.map((group) => <section className="space-y-2" key={group.storeName ?? "all"}>
          {group.storeName ? <p className="px-1 pt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.storeName}</p> : null}
          {group.items.map((receipt) => {
            const paymentNames = receipt.paymentNames.filter(Boolean);
            return <button
              aria-label={`View receipt #${receipt.number}`}
              className="w-full rounded-lg border p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              id={`receipt-open-mobile-${receipt.id}`}
              key={receipt.id}
              onClick={() => openReceipt(receipt.id, `receipt-open-mobile-${receipt.id}`)}
              type="button"
            >
              <span className="flex items-start justify-between gap-3"><span className="font-mono font-semibold text-primary">#{receipt.number}</span><span className="font-semibold tabular-nums">{receipt.totalMinor === null ? "—" : formatMinorMoney(receipt.totalMinor, receipt.currencyCode)}</span></span>
              <span className="mt-1 block text-xs text-muted-foreground">{formatReceiptDate(receipt.issuedAt, timezone)}</span>
              <span className="mt-2 block font-medium">{receipt.storeName} · {receipt.registerName}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{receipt.cashierName}</span>
              <span aria-label={paymentNames.length > 0 ? `Payment methods: ${paymentNames.join(", ")}` : "No payment method recorded"} className="mt-2 block text-sm text-muted-foreground" title={paymentNames.join(", ") || undefined}>{paymentSummary(paymentNames)}</span>
              {receipt.refundStatus !== "available" ? <Badge className="mt-2" variant={receipt.refundStatus === "refunded" ? "outline" : "secondary"}><RotateCcw aria-hidden="true" />{receipt.refundStatus === "refunded" ? "Refunded" : "Partially refunded"}</Badge> : null}
            </button>;
          })}
        </section>)}
      </div>

      <Dialog.Root onOpenChange={(open) => { if (!open) closeDrawer(); }} open={isDrawerOpen}>
        <BackOfficeDetailDrawer closeLabel="Close receipt quick view" width={drawerMode === "receipt" ? "compact" : "standard"}>
          <DialogHeader className="shrink-0">
            {drawerMode !== "receipt" && detail ? (
              <div className="flex min-w-0 items-start gap-2">
                <Button
                  aria-label={`Back to receipt #${detail.receipt.number}`}
                  className="mt-0.5 size-9 shrink-0"
                  onClick={returnToUpdatedReceipt}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <DialogTitle>
                    {drawerMode === "refund-review"
                      ? "Review refund"
                      : drawerMode === "refund-success"
                        ? "Refund completed"
                        : `Refund receipt #${detail.receipt.number}`}
                  </DialogTitle>
                  <DialogDescription className="mt-1 truncate">
                    {detail.sale.storeName} · {detail.sale.registerName} · Receipt #{detail.receipt.number}
                  </DialogDescription>
                </div>
              </div>
            ) : <DialogTitle>{detail ? `Receipt #${detail.receipt.number}` : "Receipt details"}</DialogTitle>}
            {drawerMode === "receipt" && detail ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={receiptStatusVariant(detail.refundStatus)}>{receiptStatusLabel(detail.refundStatus)}</Badge>
                <span className="text-sm text-muted-foreground">{detail.sale.storeName} · {detail.sale.registerName}</span>
              </div>
            ) : null}
            {digitalReceiptNotice ? <p aria-live="polite" className="mt-3 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary" role="status">{digitalReceiptNotice}</p> : null}
          </DialogHeader>
          <DialogBody className="min-h-0 max-h-none flex-1">
            {drawerMode === "receipt" && isLoading ? <ReceiptQuickViewSkeleton /> : null}
            {drawerMode === "receipt" && !isLoading && loadError ? (
              <div className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">We couldn&apos;t load this receipt.</p>
                <Button className="mt-4" onClick={() => { if (selectedReceiptId) openReceipt(selectedReceiptId); }} type="button" variant="outline">Try again</Button>
              </div>
            ) : null}
            {drawerMode === "receipt" && !isLoading && detail ? <ReceiptSurface detail={detail} timezone={timezone} /> : null}
            {drawerMode !== "receipt" && detail ? (
              <RefundForm
                currencyCode={detail.sale.currencyCode}
                items={detail.refundFormItems}
                onBackToReceipt={returnToUpdatedReceipt}
                onWorkflowModeChange={setDrawerMode}
                originalTotalMinor={detail.sale.totalMinor}
                paymentMethods={detail.refundPaymentMethods}
                presentation="drawer"
                receiptId={detail.receipt.id}
                receiptNumber={detail.receipt.number}
                saleId={detail.sale.id}
              />
            ) : null}
          </DialogBody>
          {drawerMode === "receipt" && detail ? (
            <DialogFooter className="shrink-0 justify-end border-t px-4 py-3 sm:px-6 print:hidden">
              {detail.canReprint ? <ReceiptPrintButton printMode="receipt" /> : null}
              {detail.canReprint ? (
                <Button onClick={() => { setDigitalReceiptNotice(null); setIsDigitalReceiptOpen(true); }} ref={digitalReceiptButtonRef} type="button" variant="outline">
                  <AtSign aria-hidden="true" />
                  Digital receipt
                </Button>
              ) : null}
              {detail.canRefund && detail.refundStatus !== "refunded" ? (
                <Button onClick={() => setDrawerMode("refund")} type="button" variant="destructive">
                  <RotateCcw aria-hidden="true" />
                  Refund
                </Button>
              ) : null}
            </DialogFooter>
          ) : null}
        </BackOfficeDetailDrawer>
      </Dialog.Root>

      <Dialog.Root onOpenChange={(open) => { if (!open) closeDigitalReceipt(); }} open={isDigitalReceiptOpen}>
        {isDigitalReceiptOpen && detail ? (
          <DialogContent className="max-w-md" closeLabel="Close digital receipt">
            <DialogHeader>
              <DialogTitle>Send digital receipt</DialogTitle>
              <DialogDescription>Receipt #{detail.receipt.number} will be queued for email delivery.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ReceiptDeliveryForm
                initialRecipient={detail.deliveryRecipientEmail}
                onCancel={closeDigitalReceipt}
                onQueued={(recipient) => {
                  setDigitalReceiptNotice(`Digital receipt queued for ${recipient}.`);
                  closeDigitalReceipt();
                }}
                presentation="dialog"
                receiptId={detail.receipt.id}
              />
            </DialogBody>
          </DialogContent>
        ) : null}
      </Dialog.Root>
    </>
  );
}

function ReceiptSurface({ detail, timezone }: { detail: ReceiptDetailData; timezone: string }) {
  return (
    <div className="flex min-h-full flex-col">
      <ReceiptDocument
        cashierName={detail.sale.cashierName}
        className="min-h-full"
        currencyCode={detail.sale.currencyCode}
        discountMinor={detail.sale.discountMinor}
        issuedAt={detail.receipt.issuedAt}
        layout={detail.receiptLayout}
        lines={detail.documentLines}
        payments={detail.documentPayments}
        receiptNumber={detail.receipt.number}
        refunds={detail.documentRefunds}
        registerName={detail.sale.registerName}
        subtotalMinor={detail.sale.subtotalMinor}
        taxMinor={detail.sale.taxMinor}
        timezone={timezone}
        totalMinor={detail.sale.totalMinor}
      />
    </div>
  );
}

function ReceiptQuickViewSkeleton() {
  return (
    <div aria-live="polite" aria-label="Loading receipt" className="space-y-4">
      <span className="sr-only">Loading receipt</span>
      <div className="h-28 animate-pulse rounded-xl bg-muted" />
      <div className="space-y-3 rounded-xl border p-5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-36 animate-pulse rounded-xl border bg-muted/40" />
    </div>
  );
}
