"use client";

import { LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ManagerApprovalDialog } from "@/features/approvals/manager-approval-dialog";
import { requestManagerApprovalAction } from "@/features/approvals/actions";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { refundSaleAction } from "@/features/receipts/actions";

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

export function RefundForm({
  autoFocus = false,
  saleId,
  currencyCode,
  items,
  originalTotalMinor,
  paymentMethods,
  receiptNumber,
}: {
  autoFocus?: boolean;
  saleId: string;
  currencyCode: string;
  items: RefundableItem[];
  originalTotalMinor: number;
  paymentMethods: RefundPaymentMethod[];
  receiptNumber: number;
}) {
  const router = useRouter();
  const refundPanelRef = useRef<HTMLElement>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.saleItemId, "0"])),
  );
  const [reason, setReason] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState(paymentMethods[0]?.id ?? "");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState<string | null>(null);
  const [approvalRequestId, setApprovalRequestId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const isBusy = isPending || approvalRequestId !== null;

  useEffect(() => {
    if (!autoFocus) return;
    const frame = window.requestAnimationFrame(() => {
      refundPanelRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocus]);

  const selectedItems = useMemo(
    () =>
      items.flatMap((item) => {
        const quantity = Number(quantities[item.saleItemId] || 0);
        return Number.isInteger(quantity) && quantity > 0
          ? [{ saleItemId: item.saleItemId, quantity, item }]
          : [];
      }),
    [items, quantities],
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
      items: selectedItems.map(({ saleItemId, quantity }) => ({ saleItemId, quantity })),
      approvalRequestId: pendingApprovalRequestId,
    });
    setMessage(result.message);

    if (result.ok) {
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    }
  };

  const submit = () => {
    if (selectedItems.length === 0) {
      setMessage("Select at least one item and quantity to refund.");
      return;
    }

    if (!paymentMethodId) {
      setMessage("Select the method used to return the payment.");
      return;
    }

    if (!window.confirm("Complete this refund? The original sale stays unchanged and tracked stock will be restored.")) {
      return;
    }

    setMessage(null);
    startTransition(async () => {
      const approval = await requestManagerApprovalAction({
        operationCode: "sales.refund",
        reason,
        payload: {
          sale_id: saleId,
          payment_method_id: paymentMethodId,
          reason: reason.trim(),
          reference_number: referenceNumber.trim() || null,
          items: selectedItems.map(({ saleItemId, quantity }) => ({
            sale_item_id: saleItemId,
            quantity,
          })),
        },
      });

      if (!approval.ok) {
        setMessage(approval.message);
        return;
      }

      if (approval.decision === "APPROVAL_REQUIRED") {
        setApprovalRequestId(approval.data.approvalRequestId);
        setMessage(approval.message);
        return;
      }

      await completeRefund(null);
    });
  };

  const remainingItems = items.filter((item) => item.quantity > item.refundedQuantity);

  return (
    <section aria-labelledby="refund-title" id="refund" ref={refundPanelRef} tabIndex={-1}>
    <Card>
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
      <CardContent className="space-y-5">
        <div className="grid gap-2 rounded-lg border bg-muted/30 p-3 text-sm sm:grid-cols-2">
          <p><span className="text-muted-foreground">Original receipt:</span> <span className="font-mono font-medium">#{receiptNumber}</span></p>
          <p className="sm:text-right"><span className="text-muted-foreground">Original total:</span> <span className="font-semibold">{formatMinorMoney(originalTotalMinor, currencyCode)}</span></p>
        </div>
        {remainingItems.length > 0 ? (
          <div className="overflow-hidden rounded-lg border">
            <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground sm:grid-cols-[minmax(0,1fr)_7rem_6rem]">
              <span>Item</span>
              <span className="hidden sm:block">Available</span>
              <span className="text-right">Return qty.</span>
            </div>
            {remainingItems.map((item) => {
              const remainingQuantity = item.quantity - item.refundedQuantity;
              return (
                <div
                  className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 border-b px-3 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_6rem]"
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
                    {remainingQuantity} {item.unit}
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

        <label className="grid gap-1.5 text-sm font-medium">
          Refund reason
          <textarea
            className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isBusy}
            maxLength={500}
            minLength={2}
            onChange={(event) => setReason(event.target.value)}
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
              selectedItems.length === 0
            }
            onClick={submit}
            type="button"
            variant="destructive"
          >
            {isPending ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
            Complete refund
          </Button>
          {paymentMethods.length === 0 ? (
            <p className="text-sm text-destructive">
              No enabled refund method is available for this store.
            </p>
          ) : null}
          {message ? <p aria-live="polite" className="text-sm text-muted-foreground">{message}</p> : null}
        </div>
      </CardContent>
      {approvalRequestId ? (
        <ManagerApprovalDialog
          approvalRequestId={approvalRequestId}
          onApproved={() => {
            const requestId = approvalRequestId;
            setApprovalRequestId(null);
            startTransition(async () => {
              await completeRefund(requestId);
            });
          }}
          onCancel={() => setApprovalRequestId(null)}
          operationLabel="Refund"
        />
      ) : null}
    </Card>
    </section>
  );
}
