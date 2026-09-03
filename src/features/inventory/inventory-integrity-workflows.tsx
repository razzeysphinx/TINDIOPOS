"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Factory, LoaderCircle, PackageMinus, RotateCcw, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createAdjustmentReasonAction,
  produceCompositeAction,
  receiveStockTransferAction,
  recordInventoryAdjustmentV2Action,
  returnToSupplierAction,
  updateInventoryPolicyAction,
} from "@/features/inventory/advanced-inventory-actions";
import type { AdvancedInventoryItem } from "@/features/inventory/advanced-inventory-workflows";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type StoreOption = { id: string; name: string };
type SupplierOption = { id: string; name: string; isActive: boolean };
type AdjustmentReason = { code: string; name: string; movementType: "ADJUSTMENT" | "DAMAGE" | "LOSS" };
type Transfer = {
  id: string;
  sourceStoreName: string;
  destinationStoreName: string;
  note: string | null;
  status: "in_transit" | "partially_received";
  lines: Array<{ id: string; label: string; unit: string; quantity: number; receivedQuantity: number }>;
};
type CompositeOption = { id: string; name: string; unit: string; storeIds: string[] };
type Result = { ok: boolean; message: string };
type AdjustmentReview = {
  currentQuantity: number;
  itemLabel: string;
  nextQuantity: number;
  note: string;
  quantityDelta: string;
  reasonCode: string;
  reasonName: string;
  storeId: string;
  storeName: string;
  unit: string;
  productId: string;
  variantId: string;
};
export type InventoryIntegritySection =
  | "safeguards"
  | "adjustments"
  | "transfer-receipt"
  | "supplier-returns"
  | "production";

const ALL_INTEGRITY_SECTIONS: readonly InventoryIntegritySection[] = [
  "safeguards",
  "adjustments",
  "transfer-receipt",
  "supplier-returns",
  "production",
];

export function InventoryIntegrityWorkflows({
  stores,
  items,
  suppliers,
  policies,
  adjustmentReasons,
  inTransitTransfers,
  composites,
  sections = ALL_INTEGRITY_SECTIONS,
}: {
  stores: StoreOption[];
  items: AdvancedInventoryItem[];
  suppliers: SupplierOption[];
  policies: Record<string, "allow" | "warn" | "block">;
  adjustmentReasons: AdjustmentReason[];
  inTransitTransfers: Transfer[];
  composites: CompositeOption[];
  sections?: readonly InventoryIntegritySection[];
}) {
  const router = useRouter();
  const [isPolicyPending, startPolicyTransition] = useTransition();
  const [isReasonPending, startReasonTransition] = useTransition();
  const [isAdjustmentPending, startAdjustmentTransition] = useTransition();
  const [isTransferPending, startTransferTransition] = useTransition();
  const [isSupplierReturnPending, startSupplierReturnTransition] = useTransition();
  const [isProductionPending, startProductionTransition] = useTransition();
  const firstStoreId = stores[0]?.id ?? "";
  const firstItem = items[0];
  const [policyStoreId, setPolicyStoreId] = useState(firstStoreId);
  const [policy, setPolicy] = useState<"allow" | "warn" | "block">(policies[firstStoreId] ?? "block");
  const [policyResult, setPolicyResult] = useState<Result | null>(null);
  const [reasonCode, setReasonCode] = useState("");
  const [reasonName, setReasonName] = useState("");
  const [reasonType, setReasonType] = useState<"ADJUSTMENT" | "DAMAGE" | "LOSS">("ADJUSTMENT");
  const [reasonResult, setReasonResult] = useState<Result | null>(null);
  const [adjustmentStoreId, setAdjustmentStoreId] = useState(firstStoreId);
  const [adjustmentReasonCode, setAdjustmentReasonCode] = useState(adjustmentReasons[0]?.code ?? "");
  const [adjustmentProductId, setAdjustmentProductId] = useState(firstItem?.productId ?? "");
  const [adjustmentVariantId, setAdjustmentVariantId] = useState(firstItem?.variantId ?? "");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("1");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [adjustmentResult, setAdjustmentResult] = useState<Result | null>(null);
  const [adjustmentReview, setAdjustmentReview] = useState<AdjustmentReview | null>(null);
  const [transferId, setTransferId] = useState(inTransitTransfers[0]?.id ?? "");
  const [transferNote, setTransferNote] = useState("");
  const [transferQuantities, setTransferQuantities] = useState<Record<string, string>>(() => receiptDraft(inTransitTransfers[0]));
  const [transferResult, setTransferResult] = useState<Result | null>(null);
  const [returnStoreId, setReturnStoreId] = useState(firstStoreId);
  const [returnSupplierId, setReturnSupplierId] = useState(suppliers.find((supplier) => supplier.isActive)?.id ?? "");
  const [returnProductId, setReturnProductId] = useState(firstItem?.productId ?? "");
  const [returnVariantId, setReturnVariantId] = useState(firstItem?.variantId ?? "");
  const [returnQuantity, setReturnQuantity] = useState("1");
  const [returnNote, setReturnNote] = useState("");
  const [returnResult, setReturnResult] = useState<Result | null>(null);
  const [productionStoreId, setProductionStoreId] = useState(firstStoreId);
  const [compositeId, setCompositeId] = useState(composites[0]?.id ?? "");
  const [productionQuantity, setProductionQuantity] = useState("1");
  const [productionNote, setProductionNote] = useState("");
  const [productionResult, setProductionResult] = useState<Result | null>(null);

  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const adjustmentItems = useMemo(() => items.filter((item) => item.storeIds.includes(adjustmentStoreId)), [adjustmentStoreId, items]);
  const selectedAdjustmentItem = adjustmentItems.find((item) => item.productId === adjustmentProductId && (item.variantId ?? "") === adjustmentVariantId);
  const selectedAdjustmentReason = adjustmentReasons.find((reason) => reason.code === adjustmentReasonCode);
  const returnItems = useMemo(() => items.filter((item) => item.storeIds.includes(returnStoreId)), [items, returnStoreId]);
  const availableComposites = useMemo(() => composites.filter((composite) => composite.storeIds.includes(productionStoreId)), [composites, productionStoreId]);
  const selectedTransfer = inTransitTransfers.find((transfer) => transfer.id === transferId);
  const showSafeguards = sections.includes("safeguards");
  const showAdjustments = sections.includes("adjustments");
  const showTransferReceipt = sections.includes("transfer-receipt");
  const showSupplierReturns = sections.includes("supplier-returns");
  const showProduction = sections.includes("production");
  const title = sections.length === 1
    ? sections[0] === "transfer-receipt"
      ? "Receive stock transfer"
      : sections[0] === "supplier-returns"
        ? "Supplier returns"
        : "Inventory controls"
    : "Inventory controls";

  function complete(result: Result, setter: (result: Result) => void) {
    setter(result);
    if (result.ok) router.refresh();
  }

  function choosePolicyStore(storeId: string) {
    setPolicyStoreId(storeId);
    setPolicy(policies[storeId] ?? "block");
  }

  function chooseItem(
    value: string,
    setProductId: (value: string) => void,
    setVariantId: (value: string) => void,
  ) {
    const [productId, variantId = ""] = value.split("|");
    setProductId(productId);
    setVariantId(variantId);
  }

  function chooseAdjustmentStore(storeId: string) {
    const firstItemForStore = items.find((item) => item.storeIds.includes(storeId));
    setAdjustmentStoreId(storeId);
    setAdjustmentProductId(firstItemForStore?.productId ?? "");
    setAdjustmentVariantId(firstItemForStore?.variantId ?? "");
    setAdjustmentReview(null);
    setAdjustmentResult(null);
  }

  function chooseTransfer(nextId: string) {
    const transfer = inTransitTransfers.find((item) => item.id === nextId);
    setTransferId(nextId);
    setTransferQuantities(receiptDraft(transfer));
  }

  function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startPolicyTransition(async () => complete(await updateInventoryPolicyAction({ storeId: policyStoreId, negativeStockPolicy: policy }), setPolicyResult));
  }

  function submitReason(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startReasonTransition(async () => {
      const result = await createAdjustmentReasonAction({ code: reasonCode, name: reasonName, movementType: reasonType });
      complete(result, setReasonResult);
      if (result.ok) {
        setReasonCode("");
        setReasonName("");
      }
    });
  }

  function reviewAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdjustmentResult(null);
    const quantityDelta = Number(adjustmentQuantity);
    const store = stores.find((candidate) => candidate.id === adjustmentStoreId);

    if (!selectedAdjustmentItem || !selectedAdjustmentReason || !store || !Number.isFinite(quantityDelta) || quantityDelta === 0) {
      setAdjustmentReview(null);
      setAdjustmentResult({ ok: false, message: "Choose a store, reason, item, and non-zero quantity before reviewing." });
      return;
    }

    const currentQuantity = selectedAdjustmentItem.quantitiesByStore[adjustmentStoreId] ?? 0;
    setAdjustmentReview({
      currentQuantity,
      itemLabel: selectedAdjustmentItem.label,
      nextQuantity: currentQuantity + quantityDelta,
      note: adjustmentNote,
      productId: adjustmentProductId,
      quantityDelta: adjustmentQuantity,
      reasonCode: selectedAdjustmentReason.code,
      reasonName: selectedAdjustmentReason.name,
      storeId: adjustmentStoreId,
      storeName: store.name,
      unit: selectedAdjustmentItem.unit,
      variantId: adjustmentVariantId,
    });
  }

  function postReviewedAdjustment() {
    if (!adjustmentReview) return;
    startAdjustmentTransition(async () => {
      const result = await recordInventoryAdjustmentV2Action({
        storeId: adjustmentReview.storeId,
        reasonCode: adjustmentReview.reasonCode,
        productId: adjustmentReview.productId,
        variantId: adjustmentReview.variantId,
        quantityDelta: adjustmentReview.quantityDelta,
        note: adjustmentReview.note,
      });
      complete(result, setAdjustmentResult);
      if (result.ok) {
        setAdjustmentNote("");
        setAdjustmentReview(null);
      }
    });
  }

  function submitTransferReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTransfer) return;
    startTransferTransition(async () => {
      const result = await receiveStockTransferAction({
        stockTransferId: selectedTransfer.id,
        note: transferNote,
        lines: selectedTransfer.lines
          .map((line) => ({ stockTransferLineId: line.id, quantity: transferQuantities[line.id] ?? "" }))
          .filter((line) => Number(line.quantity) > 0),
      });
      complete(result, setTransferResult);
      if (result.ok) setTransferNote("");
    });
  }

  function submitSupplierReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startSupplierReturnTransition(async () => {
      const result = await returnToSupplierAction({
        storeId: returnStoreId,
        supplierId: returnSupplierId,
        note: returnNote,
        lines: [{ productId: returnProductId, variantId: returnVariantId, quantity: returnQuantity }],
      });
      complete(result, setReturnResult);
      if (result.ok) setReturnNote("");
    });
  }

  function submitProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startProductionTransition(async () => {
      const result = await produceCompositeAction({ storeId: productionStoreId, productId: compositeId, quantity: productionQuantity, note: productionNote });
      complete(result, setProductionResult);
      if (result.ok) setProductionNote("");
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="inventory-integrity-title">
      <div>
        <h2 className="text-lg font-semibold" id="inventory-integrity-title">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Set stock safeguards and record traceable operations without silently changing balances.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {showSafeguards ? <WorkflowCard title="Negative-stock safeguard" description="Choose what TINDIO should do when a sale would use more stock than is currently recorded." icon={<Settings2 aria-hidden="true" />}>
          {stores.length ? <form className="space-y-3" onSubmit={submitPolicy} noValidate>
            <Field label="Store"><select className={selectClassName} value={policyStoreId} onChange={(event) => choosePolicyStore(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
            <Field label="When a sale would use more stock than is recorded"><select className={selectClassName} value={policy} onChange={(event) => setPolicy(event.target.value as typeof policy)}><option value="block">Block the sale</option><option value="warn">Warn cashier, but allow sale</option><option value="allow">Allow sale without warning</option></select></Field>
            <p className="text-sm leading-6 text-muted-foreground">
              {policy === "block"
                ? "The cashier cannot continue to payment until the cart is corrected."
                : policy === "warn"
                  ? "The item can be added normally. Before payment, TINDIO warns the cashier so they can review the cart or proceed anyway."
                  : "The cashier can continue normally even if recorded stock becomes negative."}
            </p>
            <SubmitRow pending={isPolicyPending} pendingLabel="Saving safeguard..." result={policyResult} label="Save safeguard" icon={<Settings2 />} />
          </form> : <Empty message="Create a store before setting stock safeguards." />}
        </WorkflowCard> : null}

        {showAdjustments ? <WorkflowCard title="Adjustment reasons" description="Create controlled reasons, then post an adjustment with the selected reason code." icon={<AlertTriangle aria-hidden="true" />}>
          <div className="space-y-5">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitReason} noValidate>
              <Field label="Code"><Input value={reasonCode} onChange={(event) => setReasonCode(event.target.value.toUpperCase())} placeholder="DAMAGE" /></Field>
              <Field label="Name"><Input value={reasonName} onChange={(event) => setReasonName(event.target.value)} placeholder="Damaged goods" /></Field>
              <Field label="Movement type"><select className={selectClassName} value={reasonType} onChange={(event) => setReasonType(event.target.value as typeof reasonType)}><option value="ADJUSTMENT">Adjustment</option><option value="DAMAGE">Damage</option><option value="LOSS">Loss</option></select></Field>
              <div className="flex items-end"><Button disabled={isReasonPending} type="submit">{isReasonPending ? <><LoaderCircle className="animate-spin" />Adding reason...</> : <><Settings2 />Add reason</>}</Button></div>
              <div className="sm:col-span-2"><ResultMessage result={reasonResult} /></div>
            </form>
            {adjustmentReasons.length && adjustmentItems.length ? <><form className="grid gap-3 sm:grid-cols-2" onSubmit={reviewAdjustment} noValidate>
              <Field label="Store"><select className={selectClassName} value={adjustmentStoreId} onChange={(event) => chooseAdjustmentStore(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
              <Field label="Reason"><select className={selectClassName} value={adjustmentReasonCode} onChange={(event) => { setAdjustmentReasonCode(event.target.value); setAdjustmentReview(null); }}>{adjustmentReasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.name} ({reason.code})</option>)}</select></Field>
              <ItemSelect label="Item" items={adjustmentItems} productId={adjustmentProductId} variantId={adjustmentVariantId} onChange={(value) => { chooseItem(value, setAdjustmentProductId, setAdjustmentVariantId); setAdjustmentReview(null); }} />
              <Field label="Quantity change"><Input inputMode="decimal" value={adjustmentQuantity} onChange={(event) => { setAdjustmentQuantity(event.target.value); setAdjustmentReview(null); }} placeholder="Use - for a reduction" /></Field>
              <Field className="sm:col-span-2" label="Reason / notes"><Input value={adjustmentNote} onChange={(event) => { setAdjustmentNote(event.target.value); setAdjustmentReview(null); }} placeholder="Optional supporting note" /></Field>
              <div className="sm:col-span-2"><Button disabled={isAdjustmentPending} type="submit"><AlertTriangle /> Review adjustment</Button></div>
            </form>
            {adjustmentReview ? <AdjustmentReviewCard policy={policies[adjustmentReview.storeId] ?? "block"} pending={isAdjustmentPending} review={adjustmentReview} onBack={() => setAdjustmentReview(null)} onPost={postReviewedAdjustment} /> : null}
            <ResultMessage result={adjustmentResult} /></> : <Empty message="Create a reason and make a tracked item available in a store to post controlled adjustments." />}
          </div>
        </WorkflowCard> : null}

        {showTransferReceipt ? <WorkflowCard title="Receive stock transfer" description="Receive a shipped transfer in parts or all at once. Destination stock changes only as received." icon={<RotateCcw aria-hidden="true" />}>
          {inTransitTransfers.length ? <form className="space-y-3" onSubmit={submitTransferReceipt} noValidate>
            <Field label="Transfer"><select className={selectClassName} value={transferId} onChange={(event) => chooseTransfer(event.target.value)}>{inTransitTransfers.map((transfer) => <option key={transfer.id} value={transfer.id}>{transfer.sourceStoreName} → {transfer.destinationStoreName} ({transfer.status.replace("_", " ")})</option>)}</select></Field>
            {selectedTransfer?.lines.map((line) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_9rem] sm:items-end" key={line.id}><div><p className="font-medium">{line.label}</p><p className="mt-1 text-xs text-muted-foreground">{formatQuantity(line.quantity - line.receivedQuantity)} {line.unit} remaining</p></div><Field label="Receive now"><Input inputMode="decimal" value={transferQuantities[line.id] ?? ""} onChange={(event) => setTransferQuantities({ ...transferQuantities, [line.id]: event.target.value })} /></Field></div>)}
            <Field label="Receipt note"><Input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="Optional receiving note" /></Field>
            <SubmitRow pending={isTransferPending} result={transferResult} label="Receive transfer" icon={<RotateCcw />} />
          </form> : <Empty message="Shipped transfers will appear here for partial or complete receiving." />}
        </WorkflowCard> : null}

        {showSupplierReturns ? <WorkflowCard title="Return to supplier" description="Remove returned stock with an immutable supplier-return ledger entry." icon={<PackageMinus aria-hidden="true" />}>
          {stores.length && activeSuppliers.length && returnItems.length ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitSupplierReturn} noValidate>
            <Field label="Store"><select className={selectClassName} value={returnStoreId} onChange={(event) => setReturnStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
            <Field label="Supplier"><select className={selectClassName} value={returnSupplierId} onChange={(event) => setReturnSupplierId(event.target.value)}>{activeSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
            <ItemSelect label="Returned item" items={returnItems} productId={returnProductId} variantId={returnVariantId} onChange={(value) => chooseItem(value, setReturnProductId, setReturnVariantId)} />
            <Field label="Quantity"><Input inputMode="decimal" value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} /></Field>
            <Field className="sm:col-span-2" label="Return note"><Input value={returnNote} onChange={(event) => setReturnNote(event.target.value)} placeholder="Optional supplier reference" /></Field>
            <div className="sm:col-span-2"><SubmitRow pending={isSupplierReturnPending} result={returnResult} label="Post supplier return" icon={<PackageMinus />} /></div>
          </form> : <Empty message="An active supplier, store, and tracked item are required for a supplier return." />}
        </WorkflowCard> : null}

        {showProduction ? <WorkflowCard title="Produce composite item" description="Consume its recipe components, add the output, and retain the calculated production cost." icon={<Factory aria-hidden="true" />}>
          {stores.length && availableComposites.length ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitProduction} noValidate>
            <Field label="Store"><select className={selectClassName} value={productionStoreId} onChange={(event) => setProductionStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
            <Field label="Composite output"><select className={selectClassName} value={compositeId} onChange={(event) => setCompositeId(event.target.value)}>{availableComposites.map((composite) => <option key={composite.id} value={composite.id}>{composite.name}</option>)}</select></Field>
            <Field label="Quantity to produce"><Input inputMode="decimal" value={productionQuantity} onChange={(event) => setProductionQuantity(event.target.value)} /></Field>
            <Field label="Production note"><Input value={productionNote} onChange={(event) => setProductionNote(event.target.value)} placeholder="Optional batch note" /></Field>
            <div className="sm:col-span-2"><SubmitRow pending={isProductionPending} result={productionResult} label="Post production" icon={<Factory />} /></div>
          </form> : <Empty message="Create a composite product with a recipe and make it available in a store before producing it." />}
        </WorkflowCard> : null}
      </div>
    </section>
  );
}

function AdjustmentReviewCard({
  onBack,
  onPost,
  pending,
  policy,
  review,
}: {
  onBack: () => void;
  onPost: () => void;
  pending: boolean;
  policy: "allow" | "warn" | "block";
  review: AdjustmentReview;
}) {
  const quantityDelta = Number(review.quantityDelta);

  return (
    <section aria-labelledby="adjustment-review-title" className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium" id="adjustment-review-title">Review adjustment</h3><p className="mt-1 text-sm text-muted-foreground">{review.itemLabel} · {review.storeName} · {review.reasonName}</p></div><span className={quantityDelta > 0 ? "text-sm font-semibold text-primary" : "text-sm font-semibold text-destructive"}>{quantityDelta > 0 ? "+" : ""}{formatQuantity(quantityDelta)} {review.unit}</span></div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3"><ReviewMetric label="Current" value={`${formatQuantity(review.currentQuantity)} ${review.unit}`} /><ReviewMetric label="Adjustment" value={`${quantityDelta > 0 ? "+" : ""}${formatQuantity(quantityDelta)} ${review.unit}`} /><ReviewMetric label="Result" value={`${formatQuantity(review.nextQuantity)} ${review.unit}`} /></dl>
      {review.note ? <p className="mt-3 text-sm text-muted-foreground">Notes: {review.note}</p> : null}
      {review.nextQuantity < 0 ? <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">This would result in negative stock. The store’s {policy} policy is enforced by the server when posting.</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">The displayed balance is a review preview. TINDIO locks and recalculates the authoritative stock level before creating the movement.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button disabled={pending} onClick={onBack} type="button" variant="outline">Back</Button><Button disabled={pending} onClick={onPost} type="button">{pending ? <LoaderCircle className="animate-spin" /> : <AlertTriangle />} Post adjustment</Button></div>
    </section>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{value}</dd></div>;
}

function WorkflowCard({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return <Card><CardHeader className="flex-row items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">{icon}</span><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div></CardHeader><CardContent>{children}</CardContent></Card>;
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={`grid gap-1.5 ${className}`}><Label>{label}</Label>{children}</div>;
}

function ItemSelect({ label, items, productId, variantId, onChange }: { label: string; items: AdvancedInventoryItem[]; productId: string; variantId: string; onChange: (value: string) => void }) {
  return <Field label={label}><select className={selectClassName} value={`${productId}|${variantId}`} onChange={(event) => onChange(event.target.value)}>{items.map((item) => <option key={`${item.productId}|${item.variantId ?? ""}`} value={`${item.productId}|${item.variantId ?? ""}`}>{item.label}</option>)}</select></Field>;
}

function SubmitRow({ pending, result, label, pendingLabel = label, icon }: { pending: boolean; pendingLabel?: string; result: Result | null; label: string; icon: ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><ResultMessage result={result} /><Button disabled={pending} type="submit">{pending ? <LoaderCircle className="animate-spin" /> : icon}{pending ? pendingLabel : label}</Button></div>;
}

function ResultMessage({ result }: { result: Result | null }) {
  if (!result) return <span className="min-h-5 text-xs text-muted-foreground" />;
  return <p className={result.ok ? "text-xs text-primary" : "text-xs text-destructive"} role="status">{result.message}</p>;
}

function Empty({ message }: { message: string }) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{message}</p>;
}

function receiptDraft(transfer: Transfer | undefined) {
  return Object.fromEntries((transfer?.lines ?? []).map((line) => [line.id, String(line.quantity - line.receivedQuantity)]));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}
