"use client";

import {
  ArrowLeft,
  Check,
  LoaderCircle,
  Minus,
  PackageCheck,
  Plus,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ManagerApprovalDialog } from "@/features/approvals/manager-approval-dialog";
import { loadManagerApprovalStatusAction, requestManagerApprovalAction } from "@/features/approvals/actions";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { refundSaleAction } from "@/features/receipts/actions";
import { cn } from "@/lib/utils";

type RefundableItem = {
  saleItemId: string;
  name: string;
  sku: string | null;
  quantity: number;
  refundedQuantity: number;
  unit: string;
  unitPriceMinor: number;
};

type RefundPaymentMethod = {
  id: string;
  name: string;
  type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER";
  requiresReference: boolean;
};

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type ReceiptRefundWorkflowMode =
  | "refund"
  | "refund-review"
  | "refund-processing"
  | "refund-success";

type RefundFormProps = {
  autoFocus?: boolean;
  /** The dedicated receipt page and POS dialog retain their existing card presentation. */
  presentation?: "card" | "drawer";
  /** Called by legacy consumers immediately after a successful refund. */
  onCompleted?: () => void;
  /** Drawer-only return target. It is intentionally separate from close. */
  onBackToReceipt?: () => void;
  /** Lets the containing receipt drawer keep its title and actions in sync. */
  onWorkflowModeChange?: (mode: ReceiptRefundWorkflowMode) => void;
  receiptId: string;
  saleId: string;
  currencyCode: string;
  items: RefundableItem[];
  originalTotalMinor: number;
  paymentMethods: RefundPaymentMethod[];
  receiptNumber: number;
};

export function RefundForm({
  autoFocus = false,
  onCompleted,
  onBackToReceipt,
  onWorkflowModeChange,
  presentation = "card",
  receiptId,
  saleId,
  currencyCode,
  items,
  originalTotalMinor,
  paymentMethods,
  receiptNumber,
}: RefundFormProps) {
  const router = useRouter();
  const refundPanelRef = useRef<HTMLElement>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.saleItemId, "0"])),
  );
  const [reason, setReason] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [returnToStock, setReturnToStock] = useState(false);
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<"PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | null>(null);
  const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [workflowStep, setWorkflowStep] = useState<"edit" | "review" | "success">("edit");
  const [completedRefundNumber, setCompletedRefundNumber] = useState<number | null>(null);
  const isBusy = isPending || approvalStatus === "PENDING";
  const draftStorageKey = `tindio-refund-approval:${receiptId}`;
  const workflowMode: ReceiptRefundWorkflowMode = isPending
    ? "refund-processing"
    : workflowStep === "review"
      ? "refund-review"
      : workflowStep === "success"
        ? "refund-success"
        : "refund";

  useEffect(() => {
    onWorkflowModeChange?.(workflowMode);
  }, [onWorkflowModeChange, workflowMode]);

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      refundPanelRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  useEffect(() => {
    let frame: number | null = null;
    try {
      const stored = window.sessionStorage.getItem(draftStorageKey);
      if (!stored) return;
      const draft = JSON.parse(stored) as {
        approvalRequestId?: string;
        idempotencyKey?: string;
        paymentMethodId?: string;
        quantities?: Record<string, string>;
        reason?: string;
        referenceNumber?: string;
        returnToStock?: boolean;
      };
      if (!draft.approvalRequestId || !draft.idempotencyKey) return;
      frame = window.requestAnimationFrame(() => {
        setApprovalRequestId(draft.approvalRequestId ?? null);
        setIdempotencyKey(draft.idempotencyKey ?? crypto.randomUUID());
        if (draft.paymentMethodId) setPaymentMethodId(draft.paymentMethodId);
        if (draft.quantities) setQuantities(draft.quantities);
        setReason(draft.reason ?? "");
        setReferenceNumber(draft.referenceNumber ?? "");
        setReturnToStock(draft.returnToStock === true);
        setApprovalStatus("PENDING");
        setMessage("This refund is waiting for approval. Your selected items are preserved.");
      });
    } catch {
      window.sessionStorage.removeItem(draftStorageKey);
    }
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [draftStorageKey]);

  useEffect(() => {
    if (!approvalRequestId || approvalStatus !== "PENDING") return;
    let active = true;
    const check = async () => {
      const result = await loadManagerApprovalStatusAction({ approvalRequestId });
      if (!active || !result.ok) return;
      if (result.status === "APPROVED") {
        setApprovalStatus("APPROVED");
        setIsApprovalDialogOpen(false);
        setMessage("Approval received. Complete this exact refund when ready.");
      } else if (result.status === "REJECTED" || result.status === "EXPIRED" || result.status === "CANCELLED") {
        setApprovalStatus(result.status === "REJECTED" ? "REJECTED" : "EXPIRED");
        setApprovalRequestId(null);
        setIsApprovalDialogOpen(false);
        window.sessionStorage.removeItem(draftStorageKey);
        setMessage(result.status === "REJECTED" ? "This refund request was rejected." : "This refund approval expired. Review the refund and request approval again.");
      }
    };
    void check();
    const interval = window.setInterval(() => void check(), 3000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [approvalRequestId, approvalStatus, draftStorageKey]);

  const selectedItems = useMemo(
    () =>
      items.flatMap((item) => {
        const quantity = Number(quantities[item.saleItemId] || 0);
        return Number.isInteger(quantity) && quantity > 0
          ? [{ saleItemId: item.saleItemId, quantity, item, returnToStock }]
          : [];
      }),
    [items, quantities, returnToStock],
  );
  const totalMinor = selectedItems.reduce(
    (total, selection) => total + selection.item.unitPriceMinor * selection.quantity,
    0,
  );
  const selectedPaymentMethod = paymentMethods.find((method) => method.id === paymentMethodId);

  const updateQuantity = (saleItemId: string, value: string, maximum: number) => {
    if (value === "") {
      setQuantities((current) => ({ ...current, [saleItemId]: "" }));
      return;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed)) return;
    setQuantities((current) => ({
      ...current,
      [saleItemId]: String(Math.max(0, Math.min(maximum, parsed))),
    }));
  };

  const completeRefund = async (pendingApprovalRequestId: string | null) => {
    const result = await refundSaleAction({
      saleId,
      paymentMethodId,
      idempotencyKey,
      reason,
      referenceNumber,
      items: selectedItems.map(({ saleItemId, quantity, returnToStock: selectedReturnToStock }) => ({
        saleItemId,
        quantity,
        returnToStock: selectedReturnToStock,
      })),
      approvalRequestId: pendingApprovalRequestId,
    });
    setMessage(result.message);

    if (result.ok) {
      window.sessionStorage.removeItem(draftStorageKey);
      setIdempotencyKey(crypto.randomUUID());
      setApprovalRequestId(null);
      setApprovalStatus(null);
      setCompletedRefundNumber(result.data.refundNumber);

      if (presentation === "drawer") {
        setWorkflowStep("success");
        return;
      }

      onCompleted?.();
      router.refresh();
      return;
    }

    // A processing request may not be retried with the same idempotency key.
    // Do not rotate after a generic/network error: replaying the same key is
    // the safe way to discover a refund that may already have committed.
    if (result.message.includes("Try again with a new refund")) {
      setIdempotencyKey(crypto.randomUUID());
      setApprovalRequestId(null);
      setApprovalStatus(null);
    }
  };

  const validationMessage = () => {
    if (!navigator.onLine) {
      return "Refund approval requires a connection. Reconnect before continuing.";
    }
    if (selectedItems.length === 0) {
      return "Select at least one item and quantity to refund.";
    }

    if (!paymentMethodId) {
      return "Select the method used to return the payment.";
    }

    if (reason.trim().length < 2) {
      return "Enter a refund reason with at least two characters.";
    }

    if (selectedPaymentMethod?.requiresReference && !referenceNumber.trim()) {
      return "Enter the reference required for this refund method.";
    }

    return null;
  };

  const reviewRefund = () => {
    const invalidMessage = validationMessage();
    if (invalidMessage) {
      setMessage(invalidMessage);
      return;
    }

    setMessage(null);
    setWorkflowStep("review");
  };

  const requestRefund = () => {
    const invalidMessage = validationMessage();
    if (invalidMessage) {
      setMessage(invalidMessage);
      setWorkflowStep("edit");
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const approval = await requestManagerApprovalAction({
        operationCode: "sales.refund",
        reason,
        payload: {
          receipt_id: receiptId,
          receipt_number: receiptNumber,
          sale_id: saleId,
          payment_method_id: paymentMethodId,
          reason: reason.trim(),
          reference_number: referenceNumber.trim() || null,
          items: selectedItems.map(({ saleItemId, quantity }) => ({
            sale_item_id: saleItemId,
            quantity,
            return_to_stock: returnToStock,
          })),
        },
      });

      if (!approval.ok) {
        setMessage(approval.message);
        return;
      }

      if (approval.decision === "APPROVAL_REQUIRED") {
        setApprovalRequestId(approval.data.approvalRequestId);
        setApprovalStatus("PENDING");
        setIsApprovalDialogOpen(true);
        window.sessionStorage.setItem(draftStorageKey, JSON.stringify({
          approvalRequestId: approval.data.approvalRequestId,
          idempotencyKey,
          paymentMethodId,
          quantities,
          reason,
          referenceNumber,
          returnToStock,
        }));
        setMessage(approval.message);
        return;
      }

      await completeRefund(null);
    });
  };

  const selectAllRefundableItems = () => {
    const allSelected = remainingItems.every((item) => {
      const remainingQuantity = item.quantity - item.refundedQuantity;
      return Number(quantities[item.saleItemId] || 0) === remainingQuantity;
    });

    setQuantities(
      Object.fromEntries(
        items.map((item) => {
          const remainingQuantity = item.quantity - item.refundedQuantity;
          return [item.saleItemId, allSelected ? "0" : String(Math.max(0, remainingQuantity))];
        }),
      ),
    );
  };

  const remainingItems = items.filter((item) => item.quantity > item.refundedQuantity);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const selectedQuantity = selectedItems.reduce((total, item) => total + item.quantity, 0);
  const isReadyForReview =
    !isBusy
    && remainingItems.length > 0
    && Boolean(paymentMethodId)
    && selectedItems.length > 0
    && reason.trim().length >= 2
    && !Boolean(selectedPaymentMethod?.requiresReference && !referenceNumber.trim());

  useEffect(() => {
    if (presentation !== "drawer" || workflowStep === "edit") return;
    const frame = window.requestAnimationFrame(() => reviewHeadingRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [presentation, workflowStep]);

  const returnFromWorkflow = () => {
    setMessage(null);
    if (workflowStep === "review") {
      setWorkflowStep("edit");
      return;
    }
    onBackToReceipt?.();
  };

  return (
    <section aria-labelledby="refund-title" id="refund" ref={refundPanelRef} tabIndex={-1}>
    <Card className={presentation === "drawer" ? "border-0 shadow-none" : undefined}>
      {presentation === "card" ? (
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
          <RotateCcw className="size-5" aria-hidden="true" />
        </span>
        <div>
          <CardTitle id="refund-title">Issue refund</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Return only the quantities received. The original sale and receipt remain unchanged.
          </p>
        </div>
      </CardHeader>
      ) : <h2 className="sr-only" id="refund-title">Refund receipt #{receiptNumber}</h2>}
      <CardContent className="space-y-5">
        {workflowStep === "success" ? (
          <div className="space-y-5 py-4 text-center">
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
              <Check aria-hidden="true" className="size-6" />
            </span>
            <div>
              <h3 className="text-lg font-semibold" ref={reviewHeadingRef} tabIndex={-1}>Refund completed</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {completedRefundNumber ? `Refund #${completedRefundNumber} was recorded.` : "The refund was recorded."}
              </p>
            </div>
            {presentation === "drawer" ? (
              <Button className="h-11 w-full" onClick={returnFromWorkflow} type="button">
                Back to updated receipt
              </Button>
            ) : null}
          </div>
        ) : workflowStep === "review" ? (
          <div className="space-y-5">
            <div>
              <h3 className="text-lg font-semibold" ref={reviewHeadingRef} tabIndex={-1}>Review refund</h3>
              <p className="mt-1 text-sm text-muted-foreground">Confirm the payment and inventory effect before posting.</p>
            </div>
            <dl className="space-y-3 rounded-lg border p-4 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Receipt</dt><dd className="font-mono font-medium">#{receiptNumber}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Items</dt><dd className="font-medium">{selectedItems.length} line{selectedItems.length === 1 ? "" : "s"} · {selectedQuantity} unit{selectedQuantity === 1 ? "" : "s"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Refund method</dt><dd className="font-medium">{selectedPaymentMethod?.name ?? "Not selected"}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-muted-foreground">Refund total</dt><dd className="text-base font-semibold">{formatMinorMoney(totalMinor, currencyCode)}</dd></div>
            </dl>
            <div className="rounded-lg bg-muted/45 p-4 text-sm">
              <div className="flex items-start gap-3">
                <PackageCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
                <div><p className="font-medium">Inventory effect</p><p className="mt-1 text-muted-foreground">{returnToStock ? "Selected eligible merchandise will be returned to inventory." : "No stock will be returned; this is a financial refund only."}</p></div>
              </div>
            </div>
            <div className="rounded-lg border border-dashed p-4 text-sm"><p className="font-medium">Reason</p><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{reason}</p></div>
            {message ? <p aria-live="polite" className="text-sm text-destructive" role="status">{message}</p> : null}
            <div className={cn("flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end", presentation === "drawer" && "sticky bottom-0 -mx-6 bg-card px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3")}>
              <Button className="h-11" disabled={isBusy} onClick={() => setWorkflowStep("edit")} type="button" variant="outline"><ArrowLeft aria-hidden="true" />Back</Button>
              {approvalStatus === "APPROVED" && approvalRequestId ? (
                <Button className="h-11" disabled={isPending} onClick={() => startTransition(async () => completeRefund(approvalRequestId))} type="button" variant="destructive">{isPending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{isPending ? "Processing refund..." : `Confirm ${formatMinorMoney(totalMinor, currencyCode)} refund`}</Button>
              ) : (
                <Button className="h-11" disabled={!isReadyForReview} onClick={requestRefund} type="button" variant="destructive">{isPending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}{isPending ? "Processing refund..." : `Confirm ${formatMinorMoney(totalMinor, currencyCode)} refund`}</Button>
              )}
              {approvalStatus === "PENDING" && approvalRequestId ? <Button className="h-11" onClick={() => setIsApprovalDialogOpen(true)} type="button" variant="outline">Approve with PIN</Button> : null}
            </div>
          </div>
        ) : presentation === "drawer" ? (
          <div className="space-y-5">
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2"><p><span className="text-muted-foreground">Original receipt:</span> <span className="font-mono font-medium">#{receiptNumber}</span></p><p className="sm:text-right"><span className="text-muted-foreground">Original total:</span> <span className="font-semibold">{formatMinorMoney(originalTotalMinor, currencyCode)}</span></p></div>
            {remainingItems.length > 0 ? <><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">Select items</p><p className="mt-1 text-sm text-muted-foreground">Choose only the quantities being refunded.</p></div><Button disabled={isBusy} onClick={selectAllRefundableItems} type="button" variant="outline">Select all refundable</Button></div><div className="space-y-3">{remainingItems.map((item) => { const remainingQuantity = item.quantity - item.refundedQuantity; const selectedQuantityForItem = Number(quantities[item.saleItemId] || 0); return <article className="rounded-lg border p-4" key={item.saleItemId}><div className="flex min-w-0 flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-medium">{item.name}</p><p className="mt-1 text-xs text-muted-foreground">{formatMinorMoney(item.unitPriceMinor, currencyCode)} each{item.sku ? ` · ${item.sku}` : ""}</p></div><p className="shrink-0 font-medium tabular-nums">{formatMinorMoney(item.unitPriceMinor * selectedQuantityForItem, currencyCode)}</p></div><p className="mt-3 text-sm text-muted-foreground">Purchased {item.quantity} · Previously refunded {item.refundedQuantity} · Available {remainingQuantity} {item.unit}</p><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><span className="text-sm font-medium">Refund quantity</span><div className="flex items-center gap-2"><Button aria-label={`Decrease refund quantity for ${item.name}`} className="size-11" disabled={isBusy || selectedQuantityForItem <= 0} onClick={() => updateQuantity(item.saleItemId, String(selectedQuantityForItem - 1), remainingQuantity)} size="icon" type="button" variant="outline"><Minus aria-hidden="true" /></Button><Input aria-label={`Refund quantity for ${item.name}`} className="h-11 w-16 text-center tabular-nums" disabled={isBusy} inputMode="numeric" max={remainingQuantity} min={0} onChange={(event) => updateQuantity(item.saleItemId, event.target.value, remainingQuantity)} type="number" value={quantities[item.saleItemId] ?? "0"} /><Button aria-label={`Increase refund quantity for ${item.name}`} className="size-11" disabled={isBusy || selectedQuantityForItem >= remainingQuantity} onClick={() => updateQuantity(item.saleItemId, String(selectedQuantityForItem + 1), remainingQuantity)} size="icon" type="button" variant="outline"><Plus aria-hidden="true" /></Button></div></div></article>; })}</div></> : <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Every item on this sale has already been refunded.</div>}
            <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Refund method<select className={selectClassName} disabled={isBusy || paymentMethods.length === 0} onChange={(event) => setPaymentMethodId(event.target.value)} value={paymentMethodId}>{paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label><label className="grid gap-1.5 text-sm font-medium">Reference {selectedPaymentMethod?.requiresReference ? "(required)" : "(optional)"}<Input disabled={isBusy} maxLength={120} onChange={(event) => setReferenceNumber(event.target.value)} value={referenceNumber} /></label></div>
            <label className="flex items-start gap-3 rounded-lg border p-4 text-sm"><input aria-describedby="return-to-stock-help" checked={returnToStock} className="mt-0.5 size-4 accent-primary" disabled={isBusy} onChange={(event) => setReturnToStock(event.target.checked)} type="checkbox" /><span><span className="font-medium">Return eligible refunded items to inventory</span><span className="mt-1 block text-muted-foreground" id="return-to-stock-help">Enable only when merchandise was physically returned and accepted into sellable stock.</span></span></label>
            <label className="grid gap-1.5 text-sm font-medium">Refund reason <span className="text-destructive">*</span><textarea aria-required="true" className="min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50" disabled={isBusy} maxLength={500} minLength={2} onChange={(event) => setReason(event.target.value)} placeholder="Describe why the customer is receiving a refund." required value={reason} /></label>
            {paymentMethods.length === 0 ? <p className="text-sm text-destructive">No enabled refund method is available for this store.</p> : null}
            {message ? <p aria-live="polite" className="text-sm text-destructive" role="status">{message}</p> : null}
            <div className="sticky bottom-0 -mx-6 flex flex-col gap-3 bg-card px-6 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Refund total</p><p className="mt-1 text-xl font-semibold">{formatMinorMoney(totalMinor, currencyCode)}</p></div><Button className="h-11 sm:min-w-40" disabled={!isReadyForReview} onClick={reviewRefund} type="button" variant="destructive"><RotateCcw aria-hidden="true" />Review refund</Button></div>
          </div>
        ) : (
          <>
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Original receipt:</span> <span className="font-mono font-medium">#{receiptNumber}</span></p>
          <p className="sm:text-right"><span className="text-muted-foreground">Original total:</span> <span className="font-semibold">{formatMinorMoney(originalTotalMinor, currencyCode)}</span></p>
        </div>
        {remainingItems.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground sm:grid-cols-[minmax(0,1fr)_11rem_6rem]">
              <span>Item</span>
              <span className="hidden sm:block">Purchased · refunded · available</span>
              <span className="text-right">Return qty.</span>
            </div>
            {remainingItems.map((item) => {
              const remainingQuantity = item.quantity - item.refundedQuantity;
              return (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_11rem_6rem]"
                  key={item.saleItemId}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatMinorMoney(item.unitPriceMinor, currencyCode)} each
                      {item.sku ? ` · ${item.sku}` : ""}
                    </p>
                  </div>
                  <span className="hidden text-sm text-muted-foreground sm:block">
                    {item.quantity} · {item.refundedQuantity} · {remainingQuantity} {item.unit}
                  </span>
                  <Input
                    aria-label={`Refund quantity for ${item.name}`}
                    disabled={isBusy}
                    inputMode="numeric"
                    max={remainingQuantity}
                    min={0}
                    onChange={(event) =>
                      updateQuantity(item.saleItemId, event.target.value, remainingQuantity)
                    }
                    type="number"
                    value={quantities[item.saleItemId] ?? "0"}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Every item on this sale has already been refunded.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm font-medium">
            Refund method
            <select
              className={selectClassName}
              disabled={isBusy || paymentMethods.length === 0}
              onChange={(event) => setPaymentMethodId(event.target.value)}
              value={paymentMethodId}
            >
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Reference {selectedPaymentMethod?.requiresReference ? "(required)" : "(optional)"}
            <Input
              disabled={isBusy}
              maxLength={120}
              onChange={(event) => setReferenceNumber(event.target.value)}
              value={referenceNumber}
            />
          </label>
        </div>

        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <input
            aria-describedby="return-to-stock-help-card"
            checked={returnToStock}
            className="mt-0.5 size-4 accent-primary"
            disabled={isBusy}
            onChange={(event) => setReturnToStock(event.target.checked)}
            type="checkbox"
          />
          <span>
            <span className="font-medium">Return eligible refunded items to inventory</span>
            <span className="mt-1 block text-muted-foreground" id="return-to-stock-help-card">
              Enable only when merchandise was physically returned and accepted into sellable stock.
            </span>
          </span>
        </label>

        <label className="grid gap-1.5 text-sm font-medium">
          Refund reason (required)
          <textarea
            aria-required="true"
            className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isBusy}
            maxLength={500}
            minLength={2}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Describe why the customer is returning these items."
            required
            value={reason}
          />
        </label>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/45 p-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Refund total</p>
            <p className="mt-1 text-xl font-semibold">{formatMinorMoney(totalMinor, currencyCode)}</p>
          </div>
          <Badge variant="outline">{selectedItems.length} line{selectedItems.length === 1 ? "" : "s"}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={
              isBusy ||
              remainingItems.length === 0 ||
              !paymentMethodId ||
              selectedItems.length === 0 ||
              reason.trim().length < 2 ||
              Boolean(selectedPaymentMethod?.requiresReference && !referenceNumber.trim())
            }
            onClick={reviewRefund}
            type="button"
            variant="destructive"
          >
            {isPending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
            Review refund
          </Button>
          {approvalStatus === "PENDING" && approvalRequestId ? (
            <Button onClick={() => setIsApprovalDialogOpen(true)} type="button" variant="outline">
              Approve with PIN
            </Button>
          ) : null}
          {approvalStatus === "APPROVED" && approvalRequestId ? (
            <Button
              disabled={isPending}
              onClick={() => startTransition(async () => completeRefund(approvalRequestId))}
              type="button"
              variant="destructive"
            >
              {isPending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
              Complete approved refund
            </Button>
          ) : null}
          {paymentMethods.length === 0 ? (
            <p className="text-sm text-destructive">
              No enabled refund method is available for this store.
            </p>
          ) : null}
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
          </>
        )}
      </CardContent>
      {approvalRequestId && isApprovalDialogOpen ? (
        <ManagerApprovalDialog
          approvalRequestId={approvalRequestId}
          onApproved={() => {
            const requestId = approvalRequestId;
            setIsApprovalDialogOpen(false);
            setApprovalStatus("APPROVED");
            startTransition(async () => {
              await completeRefund(requestId);
            });
          }}
          onCancel={() => setIsApprovalDialogOpen(false)}
          onRequestApproval={() => {
            setIsApprovalDialogOpen(false);
            setMessage("Approval request sent. This refund will stay ready while an authorized manager reviews it.");
          }}
          operationLabel="Refund"
          requestAmount={formatMinorMoney(totalMinor, currencyCode)}
          requestReference={`Receipt #${receiptNumber}`}
        />
      ) : null}
    </Card>
    </section>
  );
}
