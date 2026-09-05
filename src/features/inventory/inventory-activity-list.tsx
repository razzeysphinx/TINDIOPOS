"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";

import { BackOfficeDetailDrawer } from "@/components/back-office/back-office-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type InventoryActivityRow = {
  id: string;
  actorName: string | null;
  createdAt: string;
  movementType: string;
  productName: string;
  quantityAfter: number;
  quantityBefore: number;
  quantityDelta: number;
  reason: string | null;
  referenceHref: string | null;
  referenceLabel: string | null;
  storeName: string;
  unit: string;
  unitCostMinor?: number;
  valueDeltaMinor?: number;
};

/**
 * Read-only inventory ledger presentation. It receives the already bounded,
 * server-authorized movement slice and never performs a stock mutation.
 */
export function InventoryActivityList({ currencyCode, rows }: { currencyCode: string; rows: InventoryActivityRow[] }) {
  const [selectedMovementId, setSelectedMovementId] = useState<string | null>(null);
  const selectedMovement = useMemo(
    () => rows.find((movement) => movement.id === selectedMovementId) ?? null,
    [rows, selectedMovementId],
  );

  if (!rows.length) return null;

  return <>
    <div className="divide-y rounded-xl border">
      {rows.map((movement) => {
        const isIncrease = movement.quantityDelta > 0;
        const DeltaIcon = isIncrease ? ArrowUp : ArrowDown;
        return <button
          aria-label={`View ${readableMovementType(movement.movementType).toLowerCase()} for ${movement.productName}`}
          className="grid w-full gap-3 px-4 py-4 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
          key={movement.id}
          onClick={() => setSelectedMovementId(movement.id)}
          type="button"
        >
          <span className={isIncrease ? "grid size-9 place-items-center rounded-full bg-primary/10 text-primary" : "grid size-9 place-items-center rounded-full bg-destructive/10 text-destructive"}><DeltaIcon className="size-4" aria-hidden="true" /></span>
          <span className="min-w-0"><span className="block truncate font-medium">{movement.productName}</span><span className="mt-1 block text-xs text-muted-foreground">{movement.storeName} · {readableMovementType(movement.movementType)}{movement.reason ? ` · ${movement.reason}` : ""}</span></span>
          <span className="text-left sm:text-right"><span className={isIncrease ? "font-semibold text-primary" : "font-semibold text-destructive"}>{isIncrease ? "+" : ""}{formatQuantity(movement.quantityDelta)} {movement.unit}</span><span className="mt-1 block text-xs text-muted-foreground">{formatQuantity(movement.quantityBefore)} → {formatQuantity(movement.quantityAfter)} · {formatDate(movement.createdAt)}</span></span>
        </button>;
      })}
    </div>

    <Dialog.Root open={Boolean(selectedMovement)} onOpenChange={(open) => { if (!open) setSelectedMovementId(null); }}>
      {selectedMovement ? <BackOfficeDetailDrawer closeLabel="Close inventory movement" width="standard">
        <DialogHeader>
          <DialogTitle>{readableMovementType(selectedMovement.movementType)}</DialogTitle>
          <DialogDescription>{selectedMovement.productName} · {selectedMovement.storeName}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex-1 max-h-none space-y-5">
          <div className="flex flex-wrap items-center gap-2"><Badge variant={selectedMovement.quantityDelta >= 0 ? "secondary" : "outline"}>{selectedMovement.quantityDelta >= 0 ? "Stock in" : "Stock out"}</Badge>{selectedMovement.referenceLabel ? <Badge variant="outline">{selectedMovement.referenceLabel}</Badge> : null}</div>
          <dl className="grid gap-3 sm:grid-cols-3"><Metric label="Before" value={`${formatQuantity(selectedMovement.quantityBefore)} ${selectedMovement.unit}`} /><Metric label="Change" value={`${selectedMovement.quantityDelta > 0 ? "+" : ""}${formatQuantity(selectedMovement.quantityDelta)} ${selectedMovement.unit}`} /><Metric label="After" value={`${formatQuantity(selectedMovement.quantityAfter)} ${selectedMovement.unit}`} /></dl>
          <Detail label="Store" value={selectedMovement.storeName} />
          <Detail label="When" value={formatDate(selectedMovement.createdAt)} />
          <Detail label="Why" value={selectedMovement.reason || readableMovementType(selectedMovement.movementType)} />
          <Detail label="Who" value={selectedMovement.actorName || "Employee details are restricted"} />
          {selectedMovement.referenceLabel ? <div><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Source document</p>{selectedMovement.referenceHref ? <Link className="mt-1 inline-flex text-sm font-medium text-primary hover:underline" href={selectedMovement.referenceHref}>{selectedMovement.referenceLabel}</Link> : <p className="mt-1 text-sm">{selectedMovement.referenceLabel}</p>}</div> : null}
          {selectedMovement.valueDeltaMinor !== undefined && selectedMovement.unitCostMinor !== undefined ? <section className="border-t pt-5"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Cost context</p><p className="mt-1 text-sm">{formatMoney(selectedMovement.valueDeltaMinor, currencyCode)} value change · {formatMoney(selectedMovement.unitCostMinor, currencyCode)} unit cost</p></section> : null}
          <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">This is an immutable inventory ledger record. Corrections use a controlled adjustment, count, return, or receiving workflow rather than editing this movement.</p>
        </DialogBody>
      </BackOfficeDetailDrawer> : null}
    </Dialog.Root>
  </>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="mt-1 text-sm">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="mt-1 font-semibold">{value}</p></div>;
}

function readableMovementType(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatMoney(value: number, currencyCode: string) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currencyCode }).format(value / 100);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value);
}
