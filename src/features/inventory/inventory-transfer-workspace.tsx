"use client";

import { useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { LoaderCircle, Plus, SendHorizontal, Trash2, Truck } from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { transferStockAction } from "@/features/inventory/advanced-inventory-actions";
import {
  clearInventoryOperationId,
  getInventoryOperationId,
} from "@/features/inventory/inventory-operation-id";

const selectClassName =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type DirectTransferStore = { id: string; name: string };

export type DirectTransferItem = {
  productId: string;
  variantId: string | null;
  label: string;
  unit: string;
  storeIds: string[];
  quantitiesByStore: Record<string, number>;
  targetStockByStore: Record<string, number | null>;
  incomingByStore: Record<string, number>;
};

type TransferDraftLine = {
  id: number;
  productId: string;
  quantity: string;
  variantId: string;
};

type Result = { ok: boolean; message: string } | null;

export function InventoryTransferWorkspace({
  awaitingReceiptCount,
  canCreateTransfers,
  canSendTransfers,
  items,
  stores,
  transfersEnabled,
}: {
  awaitingReceiptCount: number;
  canCreateTransfers: boolean;
  canSendTransfers: boolean;
  items: DirectTransferItem[];
  stores: DirectTransferStore[];
  transfersEnabled: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [sourceStoreId, setSourceStoreId] = useState(stores[0]?.id ?? "");
  const [destinationStoreId, setDestinationStoreId] = useState(() => stores.find((store) => store.id !== stores[0]?.id)?.id ?? "");
  const nextLineId = useRef(2);
  const [draftLines, setDraftLines] = useState<TransferDraftLine[]>(() => [draftFor(items[0], 1)]);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Result>(null);

  const eligibleItems = useMemo(
    () => items.filter((item) => item.storeIds.includes(sourceStoreId) && item.storeIds.includes(destinationStoreId)),
    [destinationStoreId, items, sourceStoreId],
  );
  const destinationOptions = stores.filter((store) => store.id !== sourceStoreId);

  function itemFor(line: Pick<TransferDraftLine, "productId" | "variantId">) {
    return eligibleItems.find((item) => item.productId === line.productId && (item.variantId ?? "") === line.variantId);
  }

  function reconcileLines(nextSourceStoreId: string, nextDestinationStoreId: string) {
    const nextEligibleItems = items.filter(
      (item) => item.storeIds.includes(nextSourceStoreId) && item.storeIds.includes(nextDestinationStoreId),
    );
    setDraftLines((current) => current.map((line) => {
      const stillEligible = nextEligibleItems.some((item) => item.productId === line.productId && (item.variantId ?? "") === line.variantId);
      return stillEligible ? line : draftFor(nextEligibleItems[0], line.id);
    }));
  }

  function chooseSource(storeId: string) {
    const nextDestinationStoreId = destinationStoreId === storeId
      ? stores.find((store) => store.id !== storeId)?.id ?? ""
      : destinationStoreId;
    setSourceStoreId(storeId);
    setDestinationStoreId(nextDestinationStoreId);
    reconcileLines(storeId, nextDestinationStoreId);
    setResult(null);
  }

  function chooseDestination(storeId: string) {
    setDestinationStoreId(storeId);
    reconcileLines(sourceStoreId, storeId);
    setResult(null);
  }

  function updateLine(id: number, value: string) {
    const [productId, variantId = ""] = value.split("|");
    setDraftLines((current) => current.map((line) => line.id === id ? { ...line, productId, variantId } : line));
    setResult(null);
  }

  function updateQuantity(id: number, quantity: string) {
    setDraftLines((current) => current.map((line) => line.id === id ? { ...line, quantity } : line));
    setResult(null);
  }

  function addLine() {
    setDraftLines((current) => [...current, draftFor(eligibleItems[0], nextLineId.current++)]);
    setResult(null);
  }

  function removeLine(id: number) {
    setDraftLines((current) => current.length > 1 ? current.filter((line) => line.id !== id) : current);
    setResult(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transfersEnabled) return;
    const payload = {
      sourceStoreId,
      destinationStoreId,
      note,
      lines: draftLines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    };
    const operationScope = "direct-store-transfer";
    startTransition(async () => {
      const nextResult = await transferStockAction({
        ...payload,
        operationId: getInventoryOperationId(operationScope, payload),
      });
      setResult(nextResult);
      if (nextResult.ok) {
        clearInventoryOperationId(operationScope);
        setDraftLines([draftFor(eligibleItems[0], nextLineId.current++)]);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="inventory-transfer-workspace-title">
      <Card>
        <CardHeader className="flex-row items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary"><Truck aria-hidden="true" /></span>
          <div className="space-y-1">
            <CardTitle id="inventory-transfer-workspace-title">Direct store transfer</CardTitle>
            <CardDescription>
              Send stock between two stores. Source stock leaves immediately; destination stock changes only when the receiving store confirms it.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {transfersEnabled && stores.length > 1 && canCreateTransfers && canSendTransfers ? <form className="space-y-4" onSubmit={submit} noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From store"><select className={selectClassName} value={sourceStoreId} onChange={(event) => chooseSource(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
              <Field label="To store"><select className={selectClassName} value={destinationStoreId} onChange={(event) => chooseDestination(event.target.value)}>{destinationOptions.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
            </div>

            {eligibleItems.length ? <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-medium">Items to send</h3><p className="mt-1 text-sm text-muted-foreground">Source availability is checked again by the server when you send.</p></div><Button onClick={addLine} size="sm" type="button" variant="outline"><Plus />Add item</Button></div>
              {draftLines.map((line) => {
                const item = itemFor(line);
                const sourceOnHand = item?.quantitiesByStore[sourceStoreId] ?? 0;
                const destinationOnHand = item?.quantitiesByStore[destinationStoreId] ?? 0;
                const sourceTarget = item?.targetStockByStore[sourceStoreId] ?? null;
                const destinationTarget = item?.targetStockByStore[destinationStoreId] ?? null;
                const safeExcess = sourceTarget === null ? null : Math.max(0, sourceOnHand - sourceTarget);
                const incoming = item?.incomingByStore[destinationStoreId] ?? 0;
                const selectedElsewhere = new Set(draftLines.filter((candidate) => candidate.id !== line.id).map((candidate) => `${candidate.productId}|${candidate.variantId}`));

                return <article className="rounded-xl border p-3" key={line.id}>
                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_10rem_auto] lg:items-end">
                    <Field label="Item"><select className={selectClassName} value={`${line.productId}|${line.variantId}`} onChange={(event) => updateLine(line.id, event.target.value)}>{eligibleItems.map((candidate) => {
                      const key = `${candidate.productId}|${candidate.variantId ?? ""}`;
                      return <option disabled={selectedElsewhere.has(key)} key={key} value={key}>{candidate.label}</option>;
                    })}</select></Field>
                    <Field label="Transfer quantity"><Input inputMode="decimal" onChange={(event) => updateQuantity(line.id, event.target.value)} value={line.quantity} /></Field>
                    <Button aria-label={`Remove ${item?.label ?? "item"}`} disabled={draftLines.length === 1} onClick={() => removeLine(line.id)} size="icon" type="button" variant="ghost"><Trash2 /></Button>
                  </div>
                  {item ? <dl className="mt-3 grid gap-2 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
                    <Metric label="Source on hand" value={`${formatQuantity(sourceOnHand)} ${item.unit}`} />
                    <Metric label="Source target" value={sourceTarget === null ? "Not set" : `${formatQuantity(sourceTarget)} ${item.unit}`} />
                    <Metric label="Safe excess" value={safeExcess === null ? "Review source" : `${formatQuantity(safeExcess)} ${item.unit}`} />
                    <Metric label="Destination on hand" value={`${formatQuantity(destinationOnHand)} ${item.unit}`} />
                    <Metric label="Destination target" value={destinationTarget === null ? "Not set" : `${formatQuantity(destinationTarget)} ${item.unit}`} />
                    <Metric label="Incoming" value={`${formatQuantity(incoming)} ${item.unit}`} />
                  </dl> : null}
                </article>;
              })}
            </div> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No tracked items are available in both selected stores. Make the item available and initialize its stock projection in both stores before transferring it.</p>}

            <Field label="Transfer note"><Input maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Optional transfer reference or handoff note" value={note} /></Field>
            <div className="flex flex-wrap items-center justify-between gap-3"><ResultMessage result={result} /><Button disabled={isPending || !eligibleItems.length} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}{isPending ? "Sending transfer..." : "Send transfer"}</Button></div>
          </form> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{!transfersEnabled ? "Stock transfers are disabled for this business." : !canCreateTransfers || !canSendTransfers ? "Your role can review transfer records, but needs both transfer creation and sending permission to dispatch stock." : "At least two authorized active stores are required for a transfer."}</p>}
        </CardContent>
      </Card>

      <Card size="sm"><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">Transfers awaiting receipt</p><p className="mt-1 text-sm text-muted-foreground">Receive all or part of a transfer below. You can record a shortage or damage with its explanation.</p></div><Badge variant={awaitingReceiptCount ? "secondary" : "outline"}>{awaitingReceiptCount} awaiting receipt</Badge></CardContent></Card>
    </section>
  );
}

function draftFor(item: DirectTransferItem | undefined, id: number): TransferDraftLine {
  return { id, productId: item?.productId ?? "", variantId: item?.variantId ?? "", quantity: "1" };
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-0.5 font-medium">{value}</dd></div>;
}

function ResultMessage({ result }: { result: Result }) {
  if (!result) return <span className="min-h-5 text-sm text-muted-foreground" />;
  return <p className={result.ok ? "text-sm text-primary" : "text-sm text-destructive"} role="status">{result.message}</p>;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}
