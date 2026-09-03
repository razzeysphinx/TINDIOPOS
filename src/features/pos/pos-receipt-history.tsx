"use client";

import { Menu } from "@base-ui/react/menu";
import { AtSign, Banknote, Building2, CircleDollarSign, CreditCard, EllipsisVertical, Printer, RotateCcw, WalletCards } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { loadPosReceiptQuickViewAction } from "@/features/pos/actions";
import type { PosReceiptDetail, PosReceiptSummary } from "@/features/pos/data";
import { useCompactPosPresentation } from "@/features/pos/pos-responsive";
import type { PosPaymentMethod } from "@/features/pos/pos-types";
import { ReceiptDeliveryForm } from "@/features/receipts/receipt-delivery-form";
import { ReceiptDocument, receiptLayoutFromSnapshot, type ReceiptRefund, type ReceiptSaleLine } from "@/features/receipts/receipt-document";
import { printReceiptDocument } from "@/features/receipts/receipt-print-button";
import { RefundForm } from "@/features/receipts/refund-form";
import { cn } from "@/lib/utils";

type PosReceiptHistoryItem = PosReceiptSummary & { canReprint: boolean; canRefund: boolean };
type ReceiptStatus = "Completed" | "Partially refunded" | "Refunded";

function formatTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit", timeZone: timezone }).format(new Date(value));
}

function receiptDateGroup(value: string, timezone: string) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: timezone, year: "numeric" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return { key: `${part("year")}-${part("month")}-${part("day")}`, label: new Intl.DateTimeFormat("en-PH", { dateStyle: "full", timeZone: timezone }).format(date) };
}

function summaryRefundStatus(receipt: PosReceiptHistoryItem): ReceiptStatus {
  if (receipt.refund_count === 0) return "Completed";
  return receipt.has_refundable_quantity ? "Partially refunded" : "Refunded";
}

function detailRefundStatus(detail: PosReceiptDetail): ReceiptStatus {
  if (detail.refunds.length === 0) return "Completed";
  const refunded = new Map<string, number>();
  for (const refund of detail.refunds) for (const item of refund.items) refunded.set(item.saleItemId, (refunded.get(item.saleItemId) ?? 0) + item.quantity);
  return detail.items.some((item) => item.quantity > (refunded.get(item.id) ?? 0)) ? "Partially refunded" : "Refunded";
}

function receiptLines(detail: PosReceiptDetail): ReceiptSaleLine[] {
  return detail.items.map((item) => ({ id: item.id, name: item.name, sku: item.sku, quantity: item.quantity, unit: item.unit, unitPriceMinor: item.unitPriceMinor, lineTotalMinor: item.lineTotalMinor }));
}

function receiptRefunds(detail: PosReceiptDetail): ReceiptRefund[] {
  return detail.refunds.map((refund) => ({
    id: refund.id,
    refundNumber: refund.number,
    totalMinor: refund.totalMinor,
    completedAt: refund.completedAt,
    reason: refund.reason,
    paymentName: refund.paymentName,
    paymentReference: refund.paymentReference,
    items: refund.items.map((item) => ({ id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, lineTotalMinor: item.lineTotalMinor })),
  }));
}

function paymentLabel(methods: PosReceiptSummary["payment_methods"]) {
  if (methods.length === 0) return "Payment";
  return methods.length > 1 ? "Split" : methods[0].name;
}

function PaymentIcon({ type }: { type: PosReceiptSummary["payment_methods"][number]["type"] }) {
  const Icon = type === "CASH" ? Banknote : type === "CARD" ? CreditCard : type === "BANK_TRANSFER" ? Building2 : type === "E_WALLET" ? WalletCards : CircleDollarSign;
  return <Icon aria-hidden="true" className="size-4" />;
}

function PaymentMarks({ methods }: { methods: PosReceiptSummary["payment_methods"] }) {
  return (
    <span aria-label={methods.length ? `Payment methods: ${methods.map((method) => method.name).join(", ")}` : "Payment method not recorded"} className="flex shrink-0 -space-x-1">
      {methods.length ? methods.slice(0, 3).map((method, index) => <span className="grid size-7 place-items-center rounded-full border bg-background text-muted-foreground" key={`${method.name}-${index}`} title={method.name}><PaymentIcon type={method.type} /></span>) : <span className="grid size-7 place-items-center rounded-full border bg-background text-muted-foreground"><CircleDollarSign aria-hidden="true" className="size-4" /></span>}
    </span>
  );
}

export function PosReceiptHistory({ paymentMethods, receipts, showEmployeeContext = false, timezone }: {
  paymentMethods: PosPaymentMethod[];
  receipts: PosReceiptHistoryItem[];
  showEmployeeContext?: boolean;
  timezone: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PosReceiptDetail | null>(null);
  const [errorReceiptId, setErrorReceiptId] = useState<string | null>(null);
  const [isDigitalOpen, setIsDigitalOpen] = useState(false);
  const [isRefundOpen, setIsRefundOpen] = useState(false);
  const [isReceiptPreviewOpen, setIsReceiptPreviewOpen] = useState(false);
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const requestId = useRef(0);
  const detailScrollRef = useRef<HTMLDivElement>(null);
  const isCompactPosPresentation = useCompactPosPresentation();

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

  const selectedReceipt = receipts.find((receipt) => receipt.receipt_id === selectedId) ?? receipts[0] ?? null;
  const selectedReceiptId = selectedReceipt?.receipt_id ?? null;
  const selectedMatchesDetail = detail?.receipt.id === selectedReceiptId;
  const hasDetailError = errorReceiptId === selectedReceiptId;

  useEffect(() => {
    if (!selectedReceiptId) return;
    const currentRequest = requestId.current + 1;
    requestId.current = currentRequest;
    void loadPosReceiptQuickViewAction({ receiptId: selectedReceiptId }).then((result) => {
      if (currentRequest !== requestId.current) return;
      if (!result.ok || !result.data) {
        setErrorReceiptId(selectedReceiptId);
        return;
      }
      setDetail(result.data);
      setErrorReceiptId(null);
      detailScrollRef.current?.scrollTo({ top: 0 });
    }).catch(() => {
      if (currentRequest === requestId.current) setErrorReceiptId(selectedReceiptId);
    });
  }, [reloadVersion, selectedReceiptId]);

  const openReceipt = (receipt: PosReceiptHistoryItem) => {
    setSelectedId(receipt.receipt_id);
    setDetail(null);
    setDeliveryNotice(null);
    if (isCompactPosPresentation) setIsReceiptPreviewOpen(true);
  };

  const receiptPreview = !selectedReceipt ? <NeutralDetail /> : hasDetailError ? <DetailError onRetry={() => { setDetail(null); setErrorReceiptId(null); setReloadVersion((current) => current + 1); }} /> : !selectedMatchesDetail || !detail ? <ReceiptDetailSkeleton receiptNumber={selectedReceipt.receipt_number} /> : (
    <ReceiptDetailPanel canRefund={selectedReceipt.canRefund} canReprint={selectedReceipt.canReprint} detail={detail} detailScrollRef={detailScrollRef} onDigitalReceipt={() => setIsDigitalOpen(true)} onRefund={() => setIsRefundOpen(true)} status={detailRefundStatus(detail)} timezone={timezone} />
  );

  const refundItems = detail ? (() => {
    const refunded = new Map<string, number>();
    for (const refund of detail.refunds) for (const item of refund.items) refunded.set(item.saleItemId, (refunded.get(item.saleItemId) ?? 0) + item.quantity);
    return detail.items.map((item) => ({ saleItemId: item.id, name: item.name, sku: item.sku, quantity: item.quantity, refundedQuantity: refunded.get(item.id) ?? 0, unit: item.unit, unitPriceMinor: item.unitPriceMinor }));
  })() : [];

  return (
    <div className="grid min-h-[32rem] flex-1 overflow-hidden rounded-xl border bg-card lg:h-full lg:min-h-0 lg:grid-cols-[minmax(19rem,35%)_minmax(0,1fr)]">
      <section aria-label="Receipt history" className="max-h-[65svh] overflow-y-auto overscroll-contain border-b lg:max-h-none lg:min-h-0 lg:border-r lg:border-b-0">
        {receiptsByDate.map((group) => <div className="border-b last:border-b-0" key={group.key}>
          <p className="sticky top-0 z-10 border-b bg-card/95 px-4 py-2 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase backdrop-blur">{group.label}</p>
          {group.receipts.map((receipt) => {
            const active = receipt.receipt_id === selectedReceipt?.receipt_id;
            const status = summaryRefundStatus(receipt);
            return <button aria-current={active ? "true" : undefined} aria-label={`View receipt #${receipt.receipt_number}`} className={cn("w-full border-b px-4 py-3 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50", active ? "border-l-2 border-l-primary bg-primary/5" : "hover:bg-muted/40")} key={receipt.receipt_id} onClick={() => openReceipt(receipt)} type="button">
              <span className="flex items-start gap-3">
                <PaymentMarks methods={receipt.payment_methods} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3"><span className="font-semibold tabular-nums">{formatMinorMoney(receipt.total_minor, receipt.currency_code)}</span><span className="shrink-0 font-mono text-sm font-semibold text-primary">#{receipt.receipt_number}</span></span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{paymentLabel(receipt.payment_methods)} · {formatTime(receipt.issued_at, timezone)}</span>
                  {showEmployeeContext ? <span className="mt-1 block truncate text-xs text-muted-foreground">{receipt.cashier_name} · {receipt.register_name}</span> : null}
                  {status !== "Completed" ? <Badge className="mt-2" variant={status === "Refunded" ? "outline" : "secondary"}>{status}</Badge> : null}
                </span>
              </span>
            </button>;
          })}
        </div>)}
      </section>

      <section aria-live="polite" className="hidden min-h-0 bg-muted/15 lg:block">{receiptPreview}</section>

      {isCompactPosPresentation ? <Dialog.Root onOpenChange={setIsReceiptPreviewOpen} open={isReceiptPreviewOpen}><DialogContent aria-label={selectedReceipt ? `Receipt #${selectedReceipt.receipt_number}` : "Receipt preview"} className="flex h-svh max-h-none max-w-none flex-col rounded-none sm:max-w-2xl" closeLabel="Close receipt preview" side="right"><div className="min-h-0 flex-1 bg-muted/15">{receiptPreview}</div></DialogContent></Dialog.Root> : null}

      <Dialog.Root onOpenChange={setIsDigitalOpen} open={isDigitalOpen}>
        {isDigitalOpen && detail ? <DialogContent className="max-w-md" closeLabel="Close digital receipt"><DialogHeader><DialogTitle>Send digital receipt</DialogTitle><DialogDescription>Queue receipt #{detail.receipt.number} for email delivery. Delivery is confirmed only when a provider reports it delivered.</DialogDescription></DialogHeader><DialogBody><ReceiptDeliveryForm initialRecipient={detail.customerEmail} onCancel={() => setIsDigitalOpen(false)} onQueued={(recipient) => { setDeliveryNotice(`Digital receipt queued for ${recipient}.`); setIsDigitalOpen(false); }} presentation="dialog" receiptId={detail.receipt.id} /></DialogBody></DialogContent> : null}
      </Dialog.Root>

      <Dialog.Root onOpenChange={setIsRefundOpen} open={isRefundOpen}>
        {isRefundOpen && detail ? <DialogContent className="flex max-h-[calc(100svh-2rem)] flex-col" closeLabel="Close refund workflow" size="wide"><DialogHeader><DialogTitle>Refund receipt #{detail.receipt.number}</DialogTitle><DialogDescription>Choose only the items and quantities the customer is returning.</DialogDescription></DialogHeader><DialogBody className="min-h-0 flex-1"><RefundForm currencyCode={detail.sale.currencyCode} items={refundItems} onCompleted={() => { setIsRefundOpen(false); setReloadVersion((current) => current + 1); }} originalTotalMinor={detail.sale.totalMinor} paymentMethods={paymentMethods.filter((method) => method.storeId === detail.sale.storeId)} receiptId={detail.receipt.id} receiptNumber={detail.receipt.number} saleId={detail.sale.id} /></DialogBody></DialogContent> : null}
      </Dialog.Root>

      {deliveryNotice ? <p aria-live="polite" className="fixed right-4 bottom-4 z-[70] max-w-sm rounded-lg border bg-background px-4 py-3 text-sm shadow-lg" role="status">{deliveryNotice}</p> : null}
    </div>
  );
}

function NeutralDetail() {
  return <div className="grid h-full min-h-[28rem] place-items-center p-6 text-center text-sm text-muted-foreground">Select a receipt to inspect it.</div>;
}

function DetailError({ onRetry }: { onRetry: () => void }) {
  return <div className="grid h-full min-h-[28rem] place-items-center p-6 text-center"><div><p className="font-medium">We couldn&apos;t load this receipt.</p><Button className="mt-4" onClick={onRetry} type="button" variant="outline">Try again</Button></div></div>;
}

function ReceiptDetailSkeleton({ receiptNumber }: { receiptNumber: number }) {
  return <div className="h-full p-5 sm:p-6"><p className="font-semibold">Receipt #{receiptNumber}</p><div className="mt-5 space-y-3" aria-label="Loading receipt details"><div className="h-20 animate-pulse rounded-lg bg-muted" /><div className="h-16 animate-pulse rounded-lg bg-muted" /><div className="h-16 animate-pulse rounded-lg bg-muted" /><div className="h-28 animate-pulse rounded-lg bg-muted" /></div></div>;
}

function ReceiptDetailPanel({ canRefund, canReprint, detail, detailScrollRef, onDigitalReceipt, onRefund, status, timezone }: {
  canRefund: boolean;
  canReprint: boolean;
  detail: PosReceiptDetail;
  detailScrollRef: RefObject<HTMLDivElement | null>;
  onDigitalReceipt: () => void;
  onRefund: () => void;
  status: ReceiptStatus;
  timezone: string;
}) {
  const layout = receiptLayoutFromSnapshot(detail.receipt.layout, { organizationName: detail.sale.organizationName, storeName: detail.sale.storeName });
  const canStartRefund = canRefund && status !== "Refunded";
  return (
    <div className="grid h-full min-h-[28rem] grid-rows-[auto_1fr]">
      <div className="z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-card/95 px-4 py-3 pr-14 backdrop-blur sm:px-6 sm:pr-16 print:hidden">
        <div className="min-w-0"><p className="font-semibold">Receipt #{detail.receipt.number} <span className="font-normal text-muted-foreground">· {formatTime(detail.receipt.issuedAt, timezone)}</span></p><Badge className="mt-1" variant={status === "Refunded" ? "outline" : "secondary"}>{status}</Badge></div>
        <div className="flex items-center gap-2">
          {canStartRefund ? <Button onClick={onRefund} size="sm" type="button" variant="destructive"><RotateCcw aria-hidden="true" />Refund</Button> : null}
          {canReprint ? <Menu.Root modal={false}><Menu.Trigger aria-label="Receipt actions" className={cn(buttonVariants({ size: "icon-sm", variant: "outline" }))}><EllipsisVertical aria-hidden="true" /></Menu.Trigger><Menu.Portal><Menu.Positioner align="end" className="z-[60]" side="bottom" sideOffset={6}><Menu.Popup className="w-48 rounded-lg border bg-popover p-1 shadow-lg outline-none"><Menu.Item className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-highlighted:bg-muted" onClick={printReceiptDocument}><Printer aria-hidden="true" className="size-4" />Print receipt</Menu.Item><Menu.Item className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none data-highlighted:bg-muted" onClick={onDigitalReceipt}><AtSign aria-hidden="true" className="size-4" />Digital receipt</Menu.Item></Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root> : null}
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-6" ref={detailScrollRef}><ReceiptDocument cashierName={detail.sale.cashierName} currencyCode={detail.sale.currencyCode} discountMinor={detail.sale.discountMinor} issuedAt={detail.receipt.issuedAt} layout={layout} lines={receiptLines(detail)} payments={detail.payments} receiptNumber={detail.receipt.number} refunds={receiptRefunds(detail)} registerName={detail.sale.registerName} subtotalMinor={detail.sale.subtotalMinor} taxMinor={detail.sale.taxMinor} timezone={timezone} totalMinor={detail.sale.totalMinor} /></div>
    </div>
  );
}
