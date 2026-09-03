"use client";

import { AtSign, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { loadPosReceiptQuickViewAction } from "@/features/pos/actions";
import type { PosReceiptDetail, PosReceiptSummary } from "@/features/pos/data";
import { useCompactPosPresentation } from "@/features/pos/pos-responsive";
import { ReceiptDeliveryForm } from "@/features/receipts/receipt-delivery-form";
import {
  ReceiptDocument,
  receiptLayoutFromSnapshot,
  type ReceiptRefund,
  type ReceiptSaleLine,
} from "@/features/receipts/receipt-document";
import { ReceiptPrintButton } from "@/features/receipts/receipt-print-button";

type PosReceiptHistoryItem = PosReceiptSummary & {
  canReprint: boolean;
  canRefund: boolean;
};

function formatDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}

function receiptDateGroup(value: string, timezone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";

  return {
    key: `${part("year")}-${part("month")}-${part("day")}`,
    label: new Intl.DateTimeFormat("en-PH", { dateStyle: "full", timeZone: timezone }).format(date),
  };
}

function refundStatus(receipt: PosReceiptHistoryItem) {
  if (receipt.refund_count === 0) return "Completed";
  return receipt.has_refundable_quantity ? "Partially refunded" : "Refunded";
}

function receiptLines(detail: PosReceiptDetail): ReceiptSaleLine[] {
  return detail.items.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
  }));
}

function receiptRefunds(detail: PosReceiptDetail): ReceiptRefund[] {
  return detail.refunds.map((refund) => ({
    id: refund.id,
    refundNumber: refund.number,
    totalMinor: refund.totalMinor,
    completedAt: refund.completedAt,
    reason: refund.reason,
    paymentName: null,
    paymentReference: null,
    items: refund.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      lineTotalMinor: item.lineTotalMinor,
    })),
  }));
}

export function PosReceiptHistory({
  receipts,
  timezone,
}: {
  receipts: PosReceiptHistoryItem[];
  timezone: string;
}) {
  const [selected, setSelected] = useState<PosReceiptHistoryItem | null>(null);
  const [detail, setDetail] = useState<PosReceiptDetail | null>(null);
  const [errorReceiptId, setErrorReceiptId] = useState<string | null>(null);
  const [isDigitalOpen, setIsDigitalOpen] = useState(false);
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);
  const isCompactPosPresentation = useCompactPosPresentation();

  const openReceipt = (receipt: PosReceiptHistoryItem) => {
    setSelected(receipt);
    setDetail(null);
    if (isCompactPosPresentation) setIsReceiptPreviewOpen(true);
  };

  const receiptsByDate = useMemo(() => {
    const groups = new Map<string, { label: string; receipts: PosReceiptHistoryItem[] }>();
    for (const receipt of receipts) {
      const group = receiptDateGroup(receipt.issued_at, timezone);
      const existing = groups.get(group.key);
      if (existing) existing.receipts.push(receipt);
      else groups.set(group.key, { label: group.label, receipts: [receipt] });
    }

    return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
  }, [receipts, timezone]);

  // The list can briefly become empty while server filters refresh. Derive the
  // visible selection from the current list instead of synchronously resetting
  // selection as the list changes, which keeps React's update flow stable.
  const selectedReceipt = selected && receipts.some((receipt) => receipt.receipt_id === selected.receipt_id)
    ? selected
    : receipts[0] ?? null;
  const selectedReceiptId = selectedReceipt?.receipt_id ?? null;
  const selectedMatchesDetail = detail?.receipt.id === selectedReceipt?.receipt_id;
  const hasDetailError = errorReceiptId === selectedReceipt?.receipt_id;

  useEffect(() => {
    if (!selectedReceiptId) return;

    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;

    void loadPosReceiptQuickViewAction({ receiptId: selectedReceiptId })
      .then((result) => {
        if (currentRequest !== requestId.current) return;
        if (!result.ok || !result.data) {
          setErrorReceiptId(selectedReceiptId);
          return;
        }
        setDetail(result.data);
      })
      .catch(() => {
        if (currentRequest === requestId.current) setErrorReceiptId(selectedReceiptId);
      });
  }, [reloadVersion, selectedReceiptId]);

  const receiptPreview = !selectedReceipt ? (
    <div className="grid min-h-[28rem] place-items-center p-6 text-center text-sm text-muted-foreground">Select a receipt to inspect it.</div>
  ) : hasDetailError ? (
    <div className="grid min-h-[28rem] place-items-center p-6 text-center">
      <div>
        <p className="font-medium">We couldn&apos;t load this receipt.</p>
        <Button
          className="mt-4"
          onClick={() => {
            setDetail(null);
            setErrorReceiptId(null);
            setReloadVersion((current) => current + 1);
          }}
          type="button"
          variant="outline"
        >
          Try again
        </Button>
      </div>
    </div>
  ) : !selectedMatchesDetail || !detail ? (
    <ReceiptDetailSkeleton receiptNumber={selectedReceipt.receipt_number} />
  ) : (
    <ReceiptDetailPanel
      canReprint={selectedReceipt.canReprint}
      detail={detail}
      onDigitalReceipt={() => setIsDigitalOpen(true)}
      refundHref={selectedReceipt.canRefund && selectedReceipt.has_refundable_quantity ? `/pos/receipts/${detail.receipt.id}?refund=1#refund` : null}
      status={refundStatus(selectedReceipt)}
      timezone={timezone}
    />
  );

  return (
    <div className="grid overflow-hidden rounded-xl border bg-card lg:grid-cols-[minmax(19rem,35%)_minmax(0,1fr)]">
      <section aria-label="Receipt history" className="max-h-[60svh] overflow-y-auto border-b lg:max-h-[calc(100svh-14rem)] lg:border-r lg:border-b-0">
        {receiptsByDate.map((group) => (
          <div className="border-b last:border-b-0" key={group.key}>
            <p className="sticky top-0 z-10 border-b bg-card/95 px-4 py-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase backdrop-blur">
              {group.label}
            </p>
            {group.receipts.map((receipt) => {
              const active = receipt.receipt_id === selectedReceipt?.receipt_id;
              const status = refundStatus(receipt);
              return (
                <button
                  aria-label={`View receipt #${receipt.receipt_number}`}
                  aria-pressed={active}
                  className={`w-full border-b px-4 py-4 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "bg-primary/5" : "hover:bg-muted/40"}`}
                  key={receipt.receipt_id}
                  onClick={() => openReceipt(receipt)}
                  type="button"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-mono font-semibold text-primary">#{receipt.receipt_number}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{formatDate(receipt.issued_at, timezone)}</span>
                    </span>
                    <span className="text-right font-semibold tabular-nums">{formatMinorMoney(receipt.total_minor, receipt.currency_code)}</span>
                  </span>
                  <span className="mt-2 block truncate text-sm font-medium">{receipt.store_name} · {receipt.register_name}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{receipt.cashier_name}</span>
                  {status !== "Completed" ? <Badge className="mt-2" variant={status === "Refunded" ? "outline" : "secondary"}>{status}</Badge> : null}
                </button>
              );
            })}
          </div>
        ))}
      </section>

      <section aria-live="polite" className="hidden min-h-[28rem] bg-muted/15 lg:block">
        {receiptPreview}
      </section>

      {isCompactPosPresentation ? (
        <Dialog.Root onOpenChange={setIsReceiptPreviewOpen} open={isReceiptPreviewOpen}>
          <DialogContent
            aria-label={selectedReceipt ? `Receipt #${selectedReceipt.receipt_number}` : "Receipt preview"}
            className="flex h-svh max-h-none max-w-none flex-col rounded-none sm:max-w-xl"
            closeLabel="Close receipt preview"
            side="right"
          >
            <div aria-live="polite" className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/15">
              {receiptPreview}
            </div>
          </DialogContent>
        </Dialog.Root>
      ) : null}

      <Dialog.Root onOpenChange={setIsDigitalOpen} open={isDigitalOpen}>
        {isDigitalOpen && detail ? (
          <DialogContent className="max-w-md" closeLabel="Close digital receipt">
            <DialogHeader>
              <DialogTitle>Digital receipt</DialogTitle>
              <DialogDescription>Send receipt #{detail.receipt.number} to the customer by email.</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ReceiptDeliveryForm onCancel={() => setIsDigitalOpen(false)} onQueued={() => setIsDigitalOpen(false)} presentation="dialog" receiptId={detail.receipt.id} />
            </DialogBody>
          </DialogContent>
        ) : null}
      </Dialog.Root>
    </div>
  );
}

function ReceiptDetailSkeleton({ receiptNumber }: { receiptNumber: number }) {
  return (
    <div className="p-5 sm:p-6">
      <p className="font-semibold">Receipt #{receiptNumber}</p>
      <div className="mt-5 space-y-3" aria-label="Loading receipt details">
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
        <div className="h-16 animate-pulse rounded-lg bg-muted" />
        <div className="h-28 animate-pulse rounded-lg bg-muted" />
      </div>
    </div>
  );
}

function ReceiptDetailPanel({
  canReprint,
  detail,
  onDigitalReceipt,
  refundHref,
  status,
  timezone,
}: {
  canReprint: boolean;
  detail: PosReceiptDetail;
  onDigitalReceipt: () => void;
  refundHref: string | null;
  status: "Completed" | "Partially refunded" | "Refunded";
  timezone: string;
}) {
  const layout = receiptLayoutFromSnapshot(detail.receipt.layout, {
    organizationName: detail.sale.organizationName,
    storeName: detail.sale.storeName,
  });

  return (
    <div className="flex min-h-[28rem] flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div>
          <p className="font-semibold">Receipt #{detail.receipt.number}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail.sale.storeName} · {detail.sale.registerName} · {detail.sale.cashierName}</p>
        </div>
        <Badge variant={status === "Refunded" ? "outline" : "secondary"}>{status}</Badge>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <ReceiptDocument
          cashierName={detail.sale.cashierName}
          currencyCode={detail.sale.currencyCode}
          discountMinor={detail.sale.discountMinor}
          issuedAt={detail.receipt.issuedAt}
          layout={layout}
          lines={receiptLines(detail)}
          payments={detail.payments}
          receiptNumber={detail.receipt.number}
          refunds={receiptRefunds(detail)}
          registerName={detail.sale.registerName}
          subtotalMinor={detail.sale.subtotalMinor}
          taxMinor={detail.sale.taxMinor}
          timezone={timezone}
          totalMinor={detail.sale.totalMinor}
        />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t px-4 py-3 sm:px-6 print:hidden">
        {canReprint ? <ReceiptPrintButton printMode="receipt" /> : null}
        <Button onClick={onDigitalReceipt} type="button" variant="outline"><AtSign aria-hidden="true" />Digital receipt</Button>
        {refundHref ? <Link className="inline-flex h-9 items-center gap-2 rounded-md bg-destructive px-3 text-sm font-medium text-destructive-foreground hover:bg-destructive/90" href={refundHref}><RotateCcw aria-hidden="true" />Refund</Link> : null}
      </div>
    </div>
  );
}
