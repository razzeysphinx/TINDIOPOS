"use client";

import { ArrowDown, ArrowUp, ReceiptText, Store, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  inventoryStockConditionLabels,
  type InventoryStockCondition,
} from "@/features/inventory/inventory-stock-status";
import { inventoryActivityLabel } from "@/features/inventory/inventory-activity-copy";

export type InventoryProductDetailData = {
  activity: Array<{
    actorName: string | null;
    createdAt: string;
    id: string;
    movementType: string;
    quantityAfter: number;
    quantityBefore: number;
    quantityDelta: number;
    reason: string;
    referenceHref: string | null;
    referenceLabel: string | null;
    storeName: string;
  }>;
  adjustmentHref: string | null;
  barcode: string | null;
  categoryName: string | null;
  closeHref: string;
  condition: InventoryStockCondition;
  fullActivityHref: string;
  countHref: string | null;
  incomingQuantity: number;
  isAvailable: boolean;
  outboundTransferQuantity: number;
  productName: string;
  projectedQuantity: number;
  inTransitQuantity: number;
  lastCount: {
    countedAt: string;
    countedQuantity: number;
    countNumber: number;
    expectedQuantity: number;
  } | null;
  purchasingHref: string | null;
  quantity: number;
  reorderPoint: number | null;
  sku: string | null;
  storeName: string;
  stores: Array<{
    condition: InventoryStockCondition;
    isAvailable: boolean;
    quantity: number;
    reorderPoint: number | null;
    storeName: string;
  }>;
  transferHref: string | null;
  unit: string;
  variantName: string | null;
};

export function InventoryProductDetail({ detail }: { detail: InventoryProductDetailData | null }) {
  const router = useRouter();
  if (!detail) return null;

  const title = detail.variantName ? `${detail.productName} / ${detail.variantName}` : detail.productName;

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) router.replace(detail.closeHref); }}>
      <DialogContent side="right">
        <DialogHeader>
          <p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Product inventory</p>
          <DialogTitle className="mt-1">{title}</DialogTitle>
          <DialogDescription>{detail.categoryName ?? "Uncategorized"} · {detail.storeName}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-6">
          <section aria-labelledby="inventory-detail-summary" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium" id="inventory-detail-summary">Summary</h2><DetailConditionBadge condition={detail.condition} /></div>
            {detail.condition === "negative" ? <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Negative stock needs investigation before correction. Review the contributing activity and last physical count below; TINDIO will still enforce this store&apos;s existing negative-stock policy.</p> : null}
            <dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
              <SummaryMetric label="On hand" value={`${formatQuantity(detail.quantity)} ${detail.unit}`} />
              <SummaryMetric label="Incoming purchase orders" value={`${formatQuantity(detail.incomingQuantity)} ${detail.unit}`} />
              <SummaryMetric label="Transfer inbound" value={`${formatQuantity(detail.inTransitQuantity)} ${detail.unit}`} />
              <SummaryMetric label="Transfer outbound" value={`${formatQuantity(detail.outboundTransferQuantity)} ${detail.unit}`} />
              <SummaryMetric label="Projected stock" value={`${formatQuantity(detail.projectedQuantity)} ${detail.unit}`} />
              <SummaryMetric label="Last counted" value={detail.lastCount ? formatDate(detail.lastCount.countedAt) : "Never"} />
              <SummaryMetric label="Selling availability" value={detail.isAvailable ? "Available" : "Off"} />
              <SummaryMetric label="Reorder level" value={detail.reorderPoint === null ? "Not configured" : `${formatQuantity(detail.reorderPoint)} ${detail.unit}`} />
              <SummaryMetric label="Store" value={detail.storeName} />
            </dl>
            {detail.sku || detail.barcode ? <p className="text-xs text-muted-foreground">{detail.sku ? `SKU: ${detail.sku}` : null}{detail.sku && detail.barcode ? " · " : null}{detail.barcode ? `Barcode: ${detail.barcode}` : null}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={detail.fullActivityHref}>View full activity</Link>
              {detail.countHref ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={detail.countHref}>Start count</Link> : null}
              {detail.adjustmentHref ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={detail.adjustmentHref}>Adjust stock</Link> : null}
              {detail.transferHref ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} href={detail.transferHref}>Create transfer</Link> : null}
            </div>
          </section>

          <section aria-labelledby="inventory-detail-count" className="space-y-3">
            <h2 className="font-medium" id="inventory-detail-count">Last physical count</h2>
            {detail.lastCount ? <dl className="grid gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-3"><SummaryMetric label="Count" value={`IC-${String(detail.lastCount.countNumber).padStart(6, "0")}`} /><SummaryMetric label="Expected" value={`${formatQuantity(detail.lastCount.expectedQuantity)} ${detail.unit}`} /><SummaryMetric label="Counted" value={`${formatQuantity(detail.lastCount.countedQuantity)} ${detail.unit}`} /></dl> : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">This stock position has no completed physical count yet.</p>}
          </section>

          <section aria-labelledby="inventory-detail-stores" className="space-y-3">
            <h2 className="font-medium" id="inventory-detail-stores">By store</h2>
            <div className="space-y-2">
              {detail.stores.map((store) => <article className="flex items-center justify-between gap-3 rounded-xl border p-3" key={store.storeName}><div className="min-w-0"><p className="truncate font-medium">{store.storeName}</p><p className="mt-1 text-xs text-muted-foreground">Reorder {store.reorderPoint === null ? "not configured" : formatQuantity(store.reorderPoint)}</p></div><div className="flex shrink-0 items-center gap-2"><p className="text-right text-sm font-semibold">{formatQuantity(store.quantity)}<span className="ml-1 text-xs font-normal text-muted-foreground">{detail.unit}</span></p><DetailConditionBadge condition={store.condition} /><Badge variant={store.isAvailable ? "secondary" : "outline"}>{store.isAvailable ? "Available" : "Off"}</Badge></div></article>)}
            </div>
          </section>

          <section aria-labelledby="inventory-detail-activity" className="space-y-3">
            <div className="flex items-center justify-between gap-3"><h2 className="font-medium" id="inventory-detail-activity">Recent activity</h2><Link className="text-sm font-medium text-primary hover:underline" href={detail.fullActivityHref}>View full activity</Link></div>
            {detail.activity.length ? <div className="space-y-3">{detail.activity.map((activity) => <ActivityEntry activity={activity} key={activity.id} />)}</div> : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No inventory activity has been recorded for this item yet.</p>}
          </section>

          {detail.purchasingHref ? <section aria-labelledby="inventory-detail-purchasing" className="rounded-xl border bg-muted/20 p-4">
            <h2 className="font-medium" id="inventory-detail-purchasing">Purchasing</h2>
            <p className="mt-1 text-sm text-muted-foreground">Purchase orders and receiving remain in the existing Purchasing workspace.</p>
            <Link className="mt-3 inline-flex text-sm font-medium text-primary hover:underline" href={detail.purchasingHref}>Open purchasing</Link>
          </section> : null}
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

function ActivityEntry({ activity }: { activity: InventoryProductDetailData["activity"][number] }) {
  const added = activity.quantityDelta > 0;
  const DeltaIcon = added ? ArrowUp : ArrowDown;
  activity = { ...activity, movementType: inventoryActivityLabel(activity.movementType) };

  return <article className="grid grid-cols-[auto_1fr] gap-3 rounded-xl border p-3"><span className={cn("grid size-8 place-items-center rounded-full", added ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}><DeltaIcon className="size-4" aria-hidden="true" /></span><div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{activity.movementType.replaceAll("_", " ")}</p><p className={cn("text-sm font-semibold", added ? "text-primary" : "text-destructive")}>{added ? "+" : ""}{formatQuantity(activity.quantityDelta)}</p></div><p className="mt-1 text-xs text-muted-foreground">{formatQuantity(activity.quantityBefore)} → {formatQuantity(activity.quantityAfter)} · {formatDate(activity.createdAt)}</p><p className="mt-2 text-sm text-muted-foreground">{activity.reason}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="inline-flex items-center gap-1"><Store className="size-3" aria-hidden="true" />{activity.storeName}</span>{activity.actorName ? <span className="inline-flex items-center gap-1"><UserRound className="size-3" aria-hidden="true" />{activity.actorName}</span> : null}{activity.referenceHref && activity.referenceLabel ? <Link className="inline-flex items-center gap-1 text-primary hover:underline" href={activity.referenceHref}><ReceiptText className="size-3" aria-hidden="true" />{activity.referenceLabel}</Link> : activity.referenceLabel ? <span>{activity.referenceLabel}</span> : null}</div></div></article>;
}

function DetailConditionBadge({ condition }: { condition: InventoryStockCondition }) {
  return <Badge variant={condition === "negative" ? "destructive" : condition === "in_stock" ? "secondary" : "outline"}>{inventoryStockConditionLabels[condition]}</Badge>;
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
