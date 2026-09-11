"use client";

import { Bell, Check, LoaderCircle, PackageCheck, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { receiveStockTransferAction } from "@/features/inventory/advanced-inventory-actions";
import { clearInventoryOperationId, getInventoryOperationId } from "@/features/inventory/inventory-operation-id";
import { receiveStockRequestAction } from "@/features/inventory/supply-chain-actions";
import type { PosIncomingTransfer } from "@/features/pos/pos-types";
import { cn } from "@/lib/utils";

type ReceiptLineDraft = {
  receivedQuantity: string;
  shortQuantity: string;
  discrepancyNote: string;
};

type ActionResult = { ok: boolean; message: string } | null;

function formatQuantity(quantity: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(quantity);
}

function remainingQuantity(line: PosIncomingTransfer["lines"][number]) {
  return Math.max(0, line.quantity - line.receivedQuantity - line.shortQuantity);
}

function createReceiptDraft(transfer: PosIncomingTransfer) {
  return Object.fromEntries(
    transfer.lines.map((line) => [line.id, {
      receivedQuantity: String(remainingQuantity(line)),
      shortQuantity: "0",
      discrepancyNote: "",
    }]),
  ) as Record<string, ReceiptLineDraft>;
}

/**
 * The notification is deliberately non-modal: it can be reviewed while a
 * cashier continues a sale. The transfer/receipt RPCs remain the only source
 * of stock state and mutate nothing while the device is offline.
 */
export function PosIncomingTransferInbox({
  enabled,
  transfers,
}: {
  enabled: boolean;
  transfers: PosIncomingTransfer[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedTransferId, setSelectedTransferId] = useState<string | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<Record<string, ReceiptLineDraft>>({});
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const [online, setOnline] = useState(true);
  const [isReceiving, startReceivingTransition] = useTransition();

  const selectedTransfer = useMemo(
    () => transfers.find((transfer) => transfer.id === selectedTransferId) ?? null,
    [selectedTransferId, transfers],
  );

  const refreshFromServer = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.onLine) router.refresh();
  }, [router]);

  useEffect(() => {
    const updateOnlineState = () => setOnline(navigator.onLine);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshFromServer();
    };

    updateOnlineState();
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("online", refreshFromServer);
    window.addEventListener("offline", updateOnlineState);
    window.addEventListener("focus", refreshFromServer);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("online", updateOnlineState);
      window.removeEventListener("online", refreshFromServer);
      window.removeEventListener("offline", updateOnlineState);
      window.removeEventListener("focus", refreshFromServer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshFromServer]);

  if (!enabled) return null;

  function selectTransfer(transfer: PosIncomingTransfer) {
    setSelectedTransferId(transfer.id);
    setReceiptDraft(createReceiptDraft(transfer));
    setNote("");
    setResult(null);
  }

  function updateLine(lineId: string, patch: Partial<ReceiptLineDraft>) {
    setReceiptDraft((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] ?? { receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" }), ...patch },
    }));
    setResult(null);
  }

  function receiveTransfer() {
    if (!selectedTransfer || !online) return;
    const lines = selectedTransfer.lines
      .map((line) => {
        const draft = receiptDraft[line.id] ?? { receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" };
        return {
          stockTransferLineId: line.id,
          receivedQuantity: draft.receivedQuantity,
          shortQuantity: draft.shortQuantity,
          discrepancyNote: draft.discrepancyNote,
        };
      })
      .filter((line) => Number(line.receivedQuantity) + Number(line.shortQuantity) > 0);
    const payload = { note, lines };
    const operationScope = `pos-incoming-transfer:receive:${selectedTransfer.id}`;

    startReceivingTransition(async () => {
      const operationId = getInventoryOperationId(operationScope, payload);
      const actionResult = selectedTransfer.stockRequestId
        ? await receiveStockRequestAction({ ...payload, operationId, stockRequestId: selectedTransfer.stockRequestId })
        : await receiveStockTransferAction({ ...payload, operationId, stockTransferId: selectedTransfer.id });

      setResult(actionResult);
      if (actionResult.ok) {
        clearInventoryOperationId(operationScope);
        router.refresh();
      }
    });
  }

  return (
    <Dialog.Root modal={false} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (nextOpen) refreshFromServer();
    }} open={open}>
      <DialogTrigger
        aria-label={`Incoming transfers${transfers.length ? `, ${transfers.length} awaiting receipt` : ""}`}
        className={cn(buttonVariants({ size: "icon", variant: "outline" }), "relative")}
        title="Incoming transfers"
      >
        <Bell aria-hidden="true" />
        {transfers.length ? (
          <span aria-hidden="true" className="absolute -top-1.5 -right-1.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
            {transfers.length > 99 ? "99+" : transfers.length}
          </span>
        ) : null}
      </DialogTrigger>
      <DialogContent
        className="flex h-svh w-full max-w-none flex-col sm:w-[32rem]"
        closeLabel="Close incoming transfers"
        nonBlocking
        side="right"
      >
        <DialogHeader>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Stock transfers</p>
          <DialogTitle>Incoming transfers</DialogTitle>
          <DialogDescription>
            Review stock that is on the way to your store. Receiving updates stock only after TINDIO verifies the transfer document.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="min-h-0 max-h-none flex-1 space-y-4">
          {!online ? (
            <p className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-5">
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden="true" />
              Transfer receipts need an internet connection. You can continue selling with TINDIO&apos;s existing offline sale protection.
            </p>
          ) : null}

          {!selectedTransfer ? (
            transfers.length ? (
              <div className="space-y-2">
                {transfers.map((transfer) => (
                  <button
                    className="w-full rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    key={transfer.id}
                    onClick={() => selectTransfer(transfer)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">TR-{String(transfer.transferNumber).padStart(6, "0")}</p>
                        <p className="mt-1 text-sm text-muted-foreground">From {transfer.sourceStoreName} to {transfer.destinationStoreName}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                        {transfer.status === "partially_received" ? "Partially received" : "In transit"}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-muted-foreground">{transfer.lines.length} item{transfer.lines.length === 1 ? "" : "s"} awaiting receipt</p>
                    <span className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary"><PackageCheck className="size-4" aria-hidden="true" />Review &amp; receive</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid min-h-52 place-items-center rounded-xl border border-dashed p-6 text-center">
                <div>
                  <PackageCheck className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 font-medium">No incoming transfers</p>
                  <p className="mt-1 text-sm text-muted-foreground">Transfers sent to your authorized stores will appear here.</p>
                </div>
              </div>
            )
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">TR-{String(selectedTransfer.transferNumber).padStart(6, "0")}</p>
                  <p className="mt-1 text-sm text-muted-foreground">From {selectedTransfer.sourceStoreName} to {selectedTransfer.destinationStoreName}</p>
                </div>
                <Button onClick={() => setSelectedTransferId(null)} size="sm" type="button" variant="outline">All transfers</Button>
              </div>
              {selectedTransfer.note ? <p className="rounded-lg bg-muted/40 p-3 text-sm text-muted-foreground">Sender note: {selectedTransfer.note}</p> : null}
              <div className="space-y-3">
                {selectedTransfer.lines.map((line) => {
                  const draft = receiptDraft[line.id] ?? { receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" };
                  return (
                    <section className="space-y-3 rounded-xl border p-3" key={line.id}>
                      <div className="flex items-start justify-between gap-3">
                        <div><p className="font-medium">{line.label}</p><p className="mt-1 text-xs text-muted-foreground">{formatQuantity(remainingQuantity(line))} {line.unit} in transit</p></div>
                        <span className="text-sm text-muted-foreground">Sent {formatQuantity(line.quantity)}</span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5"><Label htmlFor={`incoming-received-${line.id}`}>Received now</Label><Input disabled={isReceiving || !online} id={`incoming-received-${line.id}`} inputMode="decimal" min="0" onChange={(event) => updateLine(line.id, { receivedQuantity: event.target.value })} value={draft.receivedQuantity} /></div>
                        <div className="space-y-1.5"><Label htmlFor={`incoming-short-${line.id}`}>Short or damaged</Label><Input disabled={isReceiving || !online} id={`incoming-short-${line.id}`} inputMode="decimal" min="0" onChange={(event) => updateLine(line.id, { shortQuantity: event.target.value })} value={draft.shortQuantity} /></div>
                      </div>
                      <div className="space-y-1.5"><Label htmlFor={`incoming-note-${line.id}`}>Shortage or damage explanation</Label><Input disabled={isReceiving || !online} id={`incoming-note-${line.id}`} onChange={(event) => updateLine(line.id, { discrepancyNote: event.target.value })} placeholder="Required only when stock is short or damaged" value={draft.discrepancyNote} /></div>
                    </section>
                  );
                })}
              </div>
              <div className="space-y-1.5"><Label htmlFor="incoming-transfer-note">Receiving note</Label><Input disabled={isReceiving || !online} id="incoming-transfer-note" onChange={(event) => { setNote(event.target.value); setResult(null); }} placeholder="Optional receiving note" value={note} /></div>
              {result ? <p className={cn("rounded-lg p-3 text-sm", result.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>{result.message}</p> : null}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="border-t px-4 py-4 sm:px-6">
          {selectedTransfer ? (
            <Button disabled={isReceiving || !online} onClick={receiveTransfer} type="button">
              {isReceiving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
              {isReceiving ? "Receiving transfer..." : "Record receipt"}
            </Button>
          ) : null}
          <Button disabled={!online} onClick={refreshFromServer} type="button" variant="outline"><RefreshCw aria-hidden="true" />Refresh</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog.Root>
  );
}
