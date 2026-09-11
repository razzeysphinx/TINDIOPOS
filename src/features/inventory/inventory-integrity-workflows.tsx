"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Factory, LoaderCircle, PackageMinus, RotateCcw, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUnsavedChanges } from "@/components/unsaved-changes/unsaved-changes-provider";
import { ManagerApprovalDialog } from "@/features/approvals/manager-approval-dialog";
import { requestManagerApprovalAction } from "@/features/approvals/actions";
import {
  createAdjustmentReasonAction,
  produceCompositeAction,
  receiveStockTransferAction,
  recordInventoryAdjustmentV2Action,
  removeInventoryPolicyOverrideAction,
  returnToSupplierAction,
  updateInventoryPolicyAction,
  updateOrganizationInventoryPolicyAction,
} from "@/features/inventory/advanced-inventory-actions";
import {
  clearInventoryOperationId as clearPendingOperation,
  getInventoryOperationId as pendingOperationId,
} from "@/features/inventory/inventory-operation-id";
import type { AdvancedInventoryItem } from "@/features/inventory/advanced-inventory-workflows";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type StoreOption = { id: string; name: string };
type SupplierOption = { id: string; name: string; isActive: boolean };
type NegativeStockPolicy = "allow" | "warn" | "block";
type AdjustmentReason = { code: string; name: string; movementType: "ADJUSTMENT" | "DAMAGE" | "LOSS" | "OPENING_STOCK" };
type Transfer = {
  id: string;
  transferNumber: number;
  sourceStoreName: string;
  destinationStoreName: string;
  note: string | null;
  status: "in_transit" | "partially_received";
  lines: Array<{ id: string; label: string; unit: string; quantity: number; receivedQuantity: number; shortQuantity: number }>;
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
  movementType: AdjustmentReason["movementType"];
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
  organizationDefaultPolicy,
  canManageOrganizationDefault,
  canManageAdjustmentReasons = false,
  canPostAdjustments = true,
  canPostSupplierReturns = false,
  canReceiveTransfers = true,
  adjustmentReasons,
  inTransitTransfers,
  composites,
  sections = ALL_INTEGRITY_SECTIONS,
}: {
  stores: StoreOption[];
  items: AdvancedInventoryItem[];
  suppliers: SupplierOption[];
  policies: Record<string, NegativeStockPolicy>;
  organizationDefaultPolicy: NegativeStockPolicy;
  canManageOrganizationDefault: boolean;
  canManageAdjustmentReasons?: boolean;
  /** A preparer may request manager approval; direct posting still needs this capability. */
  canPostAdjustments?: boolean;
  /** Supplier-return posting remains a distinct financial and stock capability. */
  canPostSupplierReturns?: boolean;
  canReceiveTransfers?: boolean;
  adjustmentReasons: AdjustmentReason[];
  inTransitTransfers: Transfer[];
  composites: CompositeOption[];
  sections?: readonly InventoryIntegritySection[];
}) {
  const router = useRouter();
  const [isDefaultPolicyPending, startDefaultPolicyTransition] = useTransition();
  const [isOverridePolicyPending, startOverridePolicyTransition] = useTransition();
  const [isRemoveOverridePending, startRemoveOverrideTransition] = useTransition();
  const [isReasonPending, startReasonTransition] = useTransition();
  const [isAdjustmentPending, startAdjustmentTransition] = useTransition();
  const [isTransferPending, startTransferTransition] = useTransition();
  const [isSupplierReturnPending, startSupplierReturnTransition] = useTransition();
  const [isProductionPending, startProductionTransition] = useTransition();
  const firstStoreId = stores[0]?.id ?? "";
  const firstItem = items[0];
  const [defaultPolicy, setDefaultPolicy] = useState<NegativeStockPolicy>(organizationDefaultPolicy);
  const [defaultPolicyResult, setDefaultPolicyResult] = useState<Result | null>(null);
  const [isOverrideEditorOpen, setIsOverrideEditorOpen] = useState(false);
  const [overrideStoreId, setOverrideStoreId] = useState(firstStoreId);
  const [overridePolicy, setOverridePolicy] = useState<NegativeStockPolicy>(policies[firstStoreId] ?? organizationDefaultPolicy);
  const [overrideResult, setOverrideResult] = useState<Result | null>(null);
  const [removingOverrideStoreId, setRemovingOverrideStoreId] = useState<string | null>(null);
  const persistedOverridePolicy = policies[overrideStoreId] ?? organizationDefaultPolicy;
  const hasUnsavedPolicyChanges = defaultPolicy !== organizationDefaultPolicy
    || (isOverrideEditorOpen && overridePolicy !== persistedOverridePolicy);
  const { requestNavigation: requestPolicyChange } = useUnsavedChanges({
    copy: {
      title: "Discard unsaved stock policy changes?",
      description: "The policy changes you entered have not been saved. Leaving or changing stores will discard them.",
    },
    isDirty: hasUnsavedPolicyChanges,
    isSaving: isDefaultPolicyPending || isOverridePolicyPending || isRemoveOverridePending,
  });
  const [reasonCode, setReasonCode] = useState("");
  const [reasonName, setReasonName] = useState("");
  const [reasonType, setReasonType] = useState<AdjustmentReason["movementType"]>("ADJUSTMENT");
  const [reasonResult, setReasonResult] = useState<Result | null>(null);
  const [adjustmentStoreId, setAdjustmentStoreId] = useState(firstStoreId);
  const [adjustmentReasonCode, setAdjustmentReasonCode] = useState(adjustmentReasons[0]?.code ?? "");
  const [adjustmentProductId, setAdjustmentProductId] = useState(firstItem?.productId ?? "");
  const [adjustmentVariantId, setAdjustmentVariantId] = useState(firstItem?.variantId ?? "");
  const [adjustmentQuantity, setAdjustmentQuantity] = useState("1");
  const [adjustmentNote, setAdjustmentNote] = useState("");
  const [adjustmentResult, setAdjustmentResult] = useState<Result | null>(null);
  const [adjustmentReview, setAdjustmentReview] = useState<AdjustmentReview | null>(null);
  const [adjustmentApprovalRequestId, setAdjustmentApprovalRequestId] = useState<string | null>(null);
  const [transferId, setTransferId] = useState(inTransitTransfers[0]?.id ?? "");
  const [transferNote, setTransferNote] = useState("");
  const [transferQuantities, setTransferQuantities] = useState<Record<string, string>>(() => receiptDraft(inTransitTransfers[0]));
  const [transferShortQuantities, setTransferShortQuantities] = useState<Record<string, string>>(() => shortageDraft(inTransitTransfers[0]));
  const [transferDiscrepancyNotes, setTransferDiscrepancyNotes] = useState<Record<string, string>>({});
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
  const currentAdjustmentQuantity = selectedAdjustmentItem?.quantitiesByStore[adjustmentStoreId] ?? 0;
  const parsedAdjustmentQuantity = Number(adjustmentQuantity);
  const adjustmentPreviewQuantity = Number.isFinite(parsedAdjustmentQuantity)
    ? currentAdjustmentQuantity + parsedAdjustmentQuantity
    : null;
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

  function openOverrideEditor(storeId = firstStoreId) {
    setOverrideStoreId(storeId);
    setOverridePolicy(policies[storeId] ?? organizationDefaultPolicy);
    setOverrideResult(null);
    setIsOverrideEditorOpen(true);
  }

  function requestOverrideEditor(storeId = firstStoreId) {
    if (isOverrideEditorOpen && storeId !== overrideStoreId) {
      requestPolicyChange(() => openOverrideEditor(storeId));
      return;
    }
    openOverrideEditor(storeId);
  }

  function chooseOverrideStore(storeId: string) {
    setOverrideStoreId(storeId);
    setOverridePolicy(policies[storeId] ?? organizationDefaultPolicy);
    setOverrideResult(null);
  }

  function requestOverrideStoreChange(storeId: string) {
    if (storeId === overrideStoreId) return;
    requestPolicyChange(() => chooseOverrideStore(storeId));
  }

  function requestCloseOverrideEditor() {
    requestPolicyChange(() => setIsOverrideEditorOpen(false));
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
    setAdjustmentApprovalRequestId(null);
  }

  function chooseTransfer(nextId: string) {
    const transfer = inTransitTransfers.find((item) => item.id === nextId);
    setTransferId(nextId);
    setTransferQuantities(receiptDraft(transfer));
    setTransferShortQuantities(shortageDraft(transfer));
    setTransferDiscrepancyNotes({});
    setTransferResult(null);
  }

  function submitDefaultPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startDefaultPolicyTransition(async () => complete(
      await updateOrganizationInventoryPolicyAction({ negativeStockPolicy: defaultPolicy }),
      setDefaultPolicyResult,
    ));
  }

  function submitOverridePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startOverridePolicyTransition(async () => complete(
      await updateInventoryPolicyAction({ storeId: overrideStoreId, negativeStockPolicy: overridePolicy }),
      setOverrideResult,
    ));
  }

  function removeOverride(storeId = overrideStoreId) {
    setRemovingOverrideStoreId(storeId);
    startRemoveOverrideTransition(async () => {
      try {
        const result = await removeInventoryPolicyOverrideAction({ storeId });
        complete(result, setOverrideResult);
        if (result.ok) {
          setOverridePolicy(organizationDefaultPolicy);
          setIsOverrideEditorOpen(false);
        }
      } finally {
        setRemovingOverrideStoreId(null);
      }
    });
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
    setAdjustmentApprovalRequestId(null);
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
      movementType: selectedAdjustmentReason.movementType,
      storeId: adjustmentStoreId,
      storeName: store.name,
      unit: selectedAdjustmentItem.unit,
      variantId: adjustmentVariantId,
    });
  }

  function adjustmentActionPayload(review: AdjustmentReview) {
    return {
      storeId: review.storeId,
      reasonCode: review.reasonCode,
      productId: review.productId,
      variantId: review.variantId,
      quantityDelta: review.quantityDelta,
      note: review.note,
    };
  }

  function adjustmentApprovalPayload(review: AdjustmentReview) {
    return {
      store_id: review.storeId,
      product_id: review.productId,
      variant_id: review.variantId || null,
      quantity_delta: Number(review.quantityDelta),
      reason_code: review.reasonCode,
      movement_type: review.movementType,
      note: review.note.trim(),
    };
  }

  async function executeReviewedAdjustment(approvalRequestId: string | null) {
    if (!adjustmentReview) return;
    const payload = adjustmentActionPayload(adjustmentReview);
    const operationScope = "inventory-adjustment:record";
    const operationId = pendingOperationId(operationScope, payload);
    const result = await recordInventoryAdjustmentV2Action({
      ...payload,
      operationId,
      approvalRequestId,
    });
    complete(result, setAdjustmentResult);
    if (result.ok) {
      clearPendingOperation(operationScope);
      setAdjustmentNote("");
      setAdjustmentReview(null);
      setAdjustmentApprovalRequestId(null);
    }
  }

  function postReviewedAdjustment() {
    if (!adjustmentReview) return;
    startAdjustmentTransition(async () => {
      const approval = await requestManagerApprovalAction({
        operationCode: "inventory.adjust",
        reason: adjustmentReview.note,
        payload: adjustmentApprovalPayload(adjustmentReview),
      });
      if (!approval.ok) {
        setAdjustmentResult({ ok: false, message: approval.message });
        return;
      }
      if (approval.decision === "APPROVAL_REQUIRED") {
        setAdjustmentApprovalRequestId(approval.data.approvalRequestId);
        setAdjustmentResult({ ok: true, message: approval.message });
        return;
      }
      await executeReviewedAdjustment(null);
    });
  }

  function submitTransferReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTransfer) return;
    startTransferTransition(async () => {
      const payload = {
        stockTransferId: selectedTransfer.id,
        note: transferNote,
        lines: selectedTransfer.lines
          .map((line) => ({
            stockTransferLineId: line.id,
            receivedQuantity: transferQuantities[line.id] ?? "0",
            shortQuantity: transferShortQuantities[line.id] ?? "0",
            discrepancyNote: transferDiscrepancyNotes[line.id] ?? "",
          }))
          .filter((line) => Number(line.receivedQuantity) + Number(line.shortQuantity) > 0),
      };
      const operationScope = `legacy-transfer-receipt:${selectedTransfer.id}`;
      const result = await receiveStockTransferAction({
        ...payload,
        operationId: pendingOperationId(operationScope, payload),
      });
      complete(result, setTransferResult);
      if (result.ok) {
        clearPendingOperation(operationScope);
        setTransferNote("");
      }
    });
  }

  function submitSupplierReturn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startSupplierReturnTransition(async () => {
      const operationScope = "supplier-return:post";
      const payload = {
        storeId: returnStoreId,
        supplierId: returnSupplierId,
        note: returnNote,
        lines: [{ productId: returnProductId, variantId: returnVariantId, quantity: returnQuantity }],
      };
      const result = await returnToSupplierAction({ ...payload, operationId: pendingOperationId(operationScope, payload) });
      complete(result, setReturnResult);
      if (result.ok) {
        clearPendingOperation(operationScope);
        setReturnNote("");
      }
    });
  }

  function submitProduction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startProductionTransition(async () => {
      const operationScope = "production:post";
      const payload = { storeId: productionStoreId, productId: compositeId, quantity: productionQuantity, note: productionNote };
      const result = await produceCompositeAction({ ...payload, operationId: pendingOperationId(operationScope, payload) });
      complete(result, setProductionResult);
      if (result.ok) {
        clearPendingOperation(operationScope);
        setProductionNote("");
      }
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="inventory-integrity-title">
      <div>
        <h2 className="text-lg font-semibold" id="inventory-integrity-title">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">Set stock safeguards and record traceable operations without silently changing balances.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {showSafeguards ? <div className="xl:col-span-2"><WorkflowCard title="Negative Stock Policy" description="Set one default for the organization. Add an override only when a store needs different checkout behavior." icon={<Settings2 aria-hidden="true" />}>
          {stores.length ? <div className="space-y-6">
            <form className="rounded-xl border bg-muted/20 p-4" onSubmit={submitDefaultPolicy} noValidate>
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-3">
                  <Field label="Default policy for all stores"><PolicySelect disabled={!canManageOrganizationDefault} value={defaultPolicy} onChange={setDefaultPolicy} /></Field>
                  <p className="text-sm leading-6 text-muted-foreground">Applies automatically to every store unless that store has an override.</p>
                  <PolicyDescription policy={defaultPolicy} />
                </div>
                {canManageOrganizationDefault ? <div className="space-y-2"><Button disabled={isDefaultPolicyPending} type="submit">{isDefaultPolicyPending ? <><LoaderCircle className="animate-spin" />Saving default...</> : <><Settings2 />Save default</>}</Button><ResultMessage result={defaultPolicyResult} /></div> : <p className="max-w-sm text-sm text-muted-foreground">Your access is limited to store overrides. An organization-wide manager controls the default.</p>}
              </div>
            </form>

            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div><h3 className="font-medium">Store overrides</h3><p className="mt-1 text-sm text-muted-foreground">Optional. Stores without an override inherit the organization default.</p></div>
                <Button onClick={() => requestOverrideEditor()} type="button" variant="outline"><Settings2 />Add store override</Button>
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Store</th><th className="px-3 py-2 font-medium">Effective policy</th><th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 text-right font-medium">Action</th></tr></thead>
                  <tbody className="divide-y">
                    {stores.map((store) => {
                      const override = policies[store.id];
                      const effectivePolicy = override ?? organizationDefaultPolicy;
                      return <tr key={store.id}><td className="px-3 py-3 font-medium">{store.name}</td><td className="px-3 py-3"><PolicyBadge policy={effectivePolicy} /></td><td className="px-3 py-3 text-muted-foreground">{override ? "Store override" : "Organization default"}</td><td className="px-3 py-3 text-right"><div className="flex justify-end gap-2">{override ? <><Button onClick={() => requestOverrideEditor(store.id)} size="sm" type="button" variant="outline">Edit override</Button><Button disabled={isRemoveOverridePending && removingOverrideStoreId === store.id} onClick={() => removeOverride(store.id)} size="sm" type="button" variant="destructive">{isRemoveOverridePending && removingOverrideStoreId === store.id ? "Removing..." : "Remove override"}</Button></> : <Button onClick={() => requestOverrideEditor(store.id)} size="sm" type="button" variant="outline">Add override</Button>}</div></td></tr>;
                    })}
                  </tbody>
                </table>
              </div>

              {isOverrideEditorOpen ? <form className="grid gap-3 rounded-xl border border-dashed p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end" onSubmit={submitOverridePolicy} noValidate>
                <Field label="Store"><select className={selectClassName} value={overrideStoreId} onChange={(event) => requestOverrideStoreChange(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
                <Field label="Policy"><PolicySelect value={overridePolicy} onChange={setOverridePolicy} /></Field>
                <div className="flex flex-wrap gap-2"><Button disabled={isOverridePolicyPending} type="submit">{isOverridePolicyPending ? <><LoaderCircle className="animate-spin" />Saving override...</> : <><Settings2 />Save override</>}</Button>{policies[overrideStoreId] ? <Button disabled={isRemoveOverridePending && removingOverrideStoreId === overrideStoreId} onClick={() => removeOverride()} type="button" variant="destructive">{isRemoveOverridePending && removingOverrideStoreId === overrideStoreId ? "Removing..." : "Remove override"}</Button> : null}<Button onClick={requestCloseOverrideEditor} type="button" variant="ghost">Cancel</Button></div>
                <div className="md:col-span-3"><PolicyDescription policy={overridePolicy} /><ResultMessage result={overrideResult} /></div>
              </form> : null}
            </div>
          </div> : <Empty message="Create a store before setting stock safeguards." />}
        </WorkflowCard></div> : null}

        {showAdjustments ? <WorkflowCard title="Adjustment reasons" description="Create controlled reasons, then post an adjustment with the selected reason code." icon={<AlertTriangle aria-hidden="true" />}>
          <div className="space-y-5">
            {canManageAdjustmentReasons ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitReason} noValidate>
              <Field label="Code"><Input value={reasonCode} onChange={(event) => setReasonCode(event.target.value.toUpperCase())} placeholder="DAMAGE" /></Field>
              <Field label="Name"><Input value={reasonName} onChange={(event) => setReasonName(event.target.value)} placeholder="Damaged goods" /></Field>
              <Field label="Movement type"><select className={selectClassName} value={reasonType} onChange={(event) => setReasonType(event.target.value as typeof reasonType)}><option value="ADJUSTMENT">Adjustment</option><option value="DAMAGE">Damage</option><option value="LOSS">Loss</option><option value="OPENING_STOCK">Opening stock</option></select></Field>
              <div className="flex items-end"><Button disabled={isReasonPending} type="submit">{isReasonPending ? <><LoaderCircle className="animate-spin" />Adding reason...</> : <><Settings2 />Add reason</>}</Button></div>
              <div className="sm:col-span-2"><ResultMessage result={reasonResult} /></div>
            </form> : <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">Your role can post controlled adjustments using active reasons, but only inventory managers can create or change the reason list.</p>}
            {adjustmentReasons.length && adjustmentItems.length ? <><form className="grid gap-3 sm:grid-cols-2" onSubmit={reviewAdjustment} noValidate>
              <Field label="Store"><select className={selectClassName} value={adjustmentStoreId} onChange={(event) => chooseAdjustmentStore(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
              <Field label="Reason"><select className={selectClassName} value={adjustmentReasonCode} onChange={(event) => { setAdjustmentReasonCode(event.target.value); setAdjustmentReview(null); }}>{adjustmentReasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.name} ({reason.code})</option>)}</select></Field>
              <ItemSelect label="Item" items={adjustmentItems} productId={adjustmentProductId} variantId={adjustmentVariantId} onChange={(value) => { chooseItem(value, setAdjustmentProductId, setAdjustmentVariantId); setAdjustmentReview(null); }} />
              <Field label="Quantity change"><Input inputMode="decimal" value={adjustmentQuantity} onChange={(event) => { setAdjustmentQuantity(event.target.value); setAdjustmentReview(null); }} placeholder="Use - for a reduction" /></Field>
              <p className="rounded-lg border bg-muted/20 px-3 py-2 text-sm text-muted-foreground sm:col-span-2" aria-live="polite">
                Current stock: <span className="font-medium text-foreground">{formatQuantity(currentAdjustmentQuantity)} {selectedAdjustmentItem?.unit ?? "units"}</span>
                {adjustmentPreviewQuantity !== null ? <> · Preview after change: <span className="font-medium text-foreground">{formatQuantity(adjustmentPreviewQuantity)} {selectedAdjustmentItem?.unit ?? "units"}</span></> : null}
              </p>
              <Field className="sm:col-span-2" label="Explanation"><Input value={adjustmentNote} onChange={(event) => { setAdjustmentNote(event.target.value); setAdjustmentReview(null); setAdjustmentApprovalRequestId(null); }} placeholder="Required: explain why stock is changing" /></Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">Use controlled reasons such as damage, loss, found stock, data correction, opening stock, or another explained correction. Receiving, transfers, counts, sales, and refunds retain their own workflows.</p>
              <div className="sm:col-span-2"><Button disabled={isAdjustmentPending} type="submit"><AlertTriangle /> Review adjustment</Button></div>
            </form>
            {adjustmentReview ? <AdjustmentReviewCard policy={policies[adjustmentReview.storeId] ?? organizationDefaultPolicy} pending={isAdjustmentPending} postLabel={canPostAdjustments ? "Post adjustment" : "Request manager approval"} review={adjustmentReview} onBack={() => { setAdjustmentReview(null); setAdjustmentApprovalRequestId(null); }} onPost={postReviewedAdjustment} /> : null}
            <ResultMessage result={adjustmentResult} /></> : <Empty message="Create a reason and make a tracked item available in a store to post controlled adjustments." />}
            {adjustmentApprovalRequestId ? <ManagerApprovalDialog approvalRequestId={adjustmentApprovalRequestId} onApproved={() => {
              const requestId = adjustmentApprovalRequestId;
              setAdjustmentApprovalRequestId(null);
              startAdjustmentTransition(async () => { await executeReviewedAdjustment(requestId); });
            }} onCancel={() => setAdjustmentApprovalRequestId(null)} operationLabel="Inventory adjustment" /> : null}
          </div>
        </WorkflowCard> : null}

        {showTransferReceipt ? <WorkflowCard title="Receive stock transfer" description="Receive a sent transfer in parts or all at once. Destination stock changes only as received; shortages and damage need an explanation." icon={<RotateCcw aria-hidden="true" />}>
          {!canReceiveTransfers ? <Empty message="Your role can view transfer records but does not have permission to receive stock into this store." /> : inTransitTransfers.length ? <form className="space-y-3" onSubmit={submitTransferReceipt} noValidate>
            <Field label="Transfer"><select className={selectClassName} value={transferId} onChange={(event) => chooseTransfer(event.target.value)}>{inTransitTransfers.map((transfer) => <option key={transfer.id} value={transfer.id}>TR-{String(transfer.transferNumber).padStart(6, "0")} · {transfer.sourceStoreName} → {transfer.destinationStoreName} ({transfer.status.replace("_", " ")})</option>)}</select></Field>
            {selectedTransfer?.lines.map((line) => <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_8rem] sm:items-end" key={line.id}><div><p className="font-medium">{line.label}</p><p className="mt-1 text-xs text-muted-foreground">{formatQuantity(line.quantity - line.receivedQuantity - line.shortQuantity)} {line.unit} remaining</p></div><Field label="Received now"><Input inputMode="decimal" value={transferQuantities[line.id] ?? ""} onChange={(event) => setTransferQuantities({ ...transferQuantities, [line.id]: event.target.value })} /></Field><Field label="Short / damaged"><Input inputMode="decimal" value={transferShortQuantities[line.id] ?? "0"} onChange={(event) => setTransferShortQuantities({ ...transferShortQuantities, [line.id]: event.target.value })} /></Field><Field className="sm:col-span-3" label="Shortage or damage explanation"><Input value={transferDiscrepancyNotes[line.id] ?? ""} onChange={(event) => setTransferDiscrepancyNotes({ ...transferDiscrepancyNotes, [line.id]: event.target.value })} placeholder="Required only when an amount is short or damaged" /></Field></div>)}
            <Field label="Receipt note"><Input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="Optional receiving note" /></Field>
            <SubmitRow pending={isTransferPending} result={transferResult} label="Receive transfer" icon={<RotateCcw />} />
          </form> : <Empty message="Shipped transfers will appear here for partial or complete receiving." />}
        </WorkflowCard> : null}

        {showSupplierReturns ? <WorkflowCard title="Return to supplier" description="Remove returned stock with an immutable supplier-return ledger entry." icon={<PackageMinus aria-hidden="true" />}>
          {!canPostSupplierReturns ? <Empty message="You can review purchasing history, but posting supplier returns requires the supplier-return permission." /> : stores.length && activeSuppliers.length && returnItems.length ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitSupplierReturn} noValidate>
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
  postLabel,
  review,
}: {
  onBack: () => void;
  onPost: () => void;
  pending: boolean;
  policy: "allow" | "warn" | "block";
  postLabel: string;
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
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button disabled={pending} onClick={onBack} type="button" variant="outline">Back</Button><Button disabled={pending} onClick={onPost} type="button">{pending ? <LoaderCircle className="animate-spin" /> : <AlertTriangle />} {postLabel}</Button></div>
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

function PolicySelect({ disabled = false, value, onChange }: { disabled?: boolean; value: NegativeStockPolicy; onChange: (value: NegativeStockPolicy) => void }) {
  return <select className={selectClassName} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value as NegativeStockPolicy)}>
    <option value="block">Block the sale</option>
    <option value="warn">Warn cashier, but allow sale</option>
    <option value="allow">Allow sale without warning</option>
  </select>;
}

function PolicyBadge({ policy }: { policy: NegativeStockPolicy }) {
  const label = policy === "block" ? "Block" : policy === "warn" ? "Warn" : "Allow";
  const className = policy === "block"
    ? "bg-destructive/10 text-destructive"
    : policy === "warn"
      ? "bg-amber-500/10 text-amber-800 dark:text-amber-300"
      : "bg-primary/10 text-primary";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{label}</span>;
}

function PolicyDescription({ policy }: { policy: NegativeStockPolicy }) {
  const description = policy === "block"
    ? "Block: the cashier cannot continue to payment until the cart is corrected."
    : policy === "warn"
      ? "Warn: the cashier is warned at Charge and may review or proceed using the existing POS workflow."
      : "Allow: the cashier can continue normally even when recorded stock becomes negative.";
  return <p className="text-sm leading-6 text-muted-foreground">{description}</p>;
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
  return Object.fromEntries((transfer?.lines ?? []).map((line) => [line.id, String(line.quantity - line.receivedQuantity - line.shortQuantity)]));
}

function shortageDraft(transfer: Transfer | undefined) {
  return Object.fromEntries((transfer?.lines ?? []).map((line) => [line.id, "0"]));
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}
