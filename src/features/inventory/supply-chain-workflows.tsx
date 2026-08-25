"use client";

import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  LoaderCircle,
  PackageCheck,
  Plus,
  Send,
  SlidersHorizontal,
  Truck,
  Warehouse,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  approveStockRequestAction,
  createStockRequestAction,
  createSupplyChainWarehouseAction,
  dispatchStockRequestAction,
  receiveStockRequestAction,
  startStockRequestPickingAction,
  updateSupplierLeadTimeAction,
  upsertReplenishmentRuleAction,
} from "@/features/inventory/supply-chain-actions";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Store = { id: string; name: string };
type WarehouseOption = { id: string; storeId: string; code: string; name: string };
type Supplier = { id: string; name: string; leadTimeDays: number };
export type SupplyChainItem = {
  productId: string;
  variantId: string | null;
  label: string;
  unit: string;
  storeIds: string[];
  quantitiesByStore: Record<string, number>;
};
export type ReplenishmentRule = {
  id: string;
  storeId: string;
  productId: string;
  variantId: string | null;
  preferredWarehouseId: string | null;
  reorderPoint: number;
  targetStock: number;
  label: string;
  unit: string;
  currentQuantity: number;
  storeName: string;
  warehouseName: string | null;
};
export type SupplyChainRequest = {
  id: string;
  requestNumber: number;
  status: "requested" | "approved" | "picking" | "dispatched" | "partially_received" | "received" | "received_with_discrepancy" | "cancelled";
  requestingStoreName: string;
  warehouseName: string;
  note: string | null;
  requestedAt: string;
  lines: Array<{
    id: string;
    transferLineId: string | null;
    label: string;
    unit: string;
    requestedQuantity: number;
    approvedQuantity: number;
    pickedQuantity: number;
    dispatchedQuantity: number;
    receivedQuantity: number;
    shortQuantity: number;
  }>;
};
export type InboundPurchaseOrder = {
  id: string;
  orderNumber: number;
  supplierName: string;
  storeName: string;
  expectedAt: string | null;
  remainingQuantity: number;
};

type Result = { ok: boolean; message: string };
type RequestDraft = { productId: string; variantId: string; quantity: string };
type ReceiptDraft = { receivedQuantity: string; shortQuantity: string; discrepancyNote: string };

export function SupplyChainWorkflows({
  stores,
  warehouses,
  suppliers,
  items,
  rules,
  requests,
  inboundPurchaseOrders,
}: {
  stores: Store[];
  warehouses: WarehouseOption[];
  suppliers: Supplier[];
  items: SupplyChainItem[];
  rules: ReplenishmentRule[];
  requests: SupplyChainRequest[];
  inboundPurchaseOrders: InboundPurchaseOrder[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const firstStoreId = stores[0]?.id ?? "";
  const firstItem = items[0];
  const [warehouseStoreId, setWarehouseStoreId] = useState(firstStoreId);
  const [warehouseCode, setWarehouseCode] = useState("");
  const [warehouseName, setWarehouseName] = useState("");
  const [warehouseNotes, setWarehouseNotes] = useState("");
  const [warehouseResult, setWarehouseResult] = useState<Result | null>(null);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState(String(suppliers[0]?.leadTimeDays ?? 0));
  const [supplierResult, setSupplierResult] = useState<Result | null>(null);
  const [ruleStoreId, setRuleStoreId] = useState(firstStoreId);
  const [ruleProductId, setRuleProductId] = useState(firstItem?.productId ?? "");
  const [ruleVariantId, setRuleVariantId] = useState(firstItem?.variantId ?? "");
  const [ruleWarehouseId, setRuleWarehouseId] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [targetStock, setTargetStock] = useState("1");
  const [ruleResult, setRuleResult] = useState<Result | null>(null);
  const [requestStoreId, setRequestStoreId] = useState(firstStoreId);
  const [requestWarehouseId, setRequestWarehouseId] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestLines, setRequestLines] = useState<RequestDraft[]>(() => [emptyRequestLine(firstItem)]);
  const [requestResult, setRequestResult] = useState<Result | null>(null);
  const [dispatchNotes, setDispatchNotes] = useState<Record<string, string>>({});
  const [workflowResults, setWorkflowResults] = useState<Record<string, Result>>({});
  const [receiptNotes, setReceiptNotes] = useState<Record<string, string>>({});
  const [receiptDrafts, setReceiptDrafts] = useState<Record<string, Record<string, ReceiptDraft>>>({});

  const ruleItems = useMemo(
    () => items.filter((item) => item.storeIds.includes(ruleStoreId)),
    [items, ruleStoreId],
  );
  const requestItems = useMemo(
    () => items.filter((item) => item.storeIds.includes(requestStoreId)),
    [items, requestStoreId],
  );
  const eligibleRuleWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.storeId !== ruleStoreId),
    [ruleStoreId, warehouses],
  );
  const eligibleRequestWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.storeId !== requestStoreId),
    [requestStoreId, warehouses],
  );

  function finish(result: Result, setResult: Dispatch<SetStateAction<Result | null>>) {
    setResult(result);
    if (result.ok) router.refresh();
  }

  function finishWorkflow(requestId: string, result: Result) {
    setWorkflowResults((current) => ({ ...current, [requestId]: result }));
    if (result.ok) router.refresh();
  }

  function selectSupplier(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    setLeadTimeDays(String(suppliers.find((supplier) => supplier.id === nextSupplierId)?.leadTimeDays ?? 0));
  }

  function selectRuleItem(value: string) {
    const [productId, variantId = ""] = value.split("|");
    setRuleProductId(productId);
    setRuleVariantId(variantId);
  }

  function selectRequestItem(index: number, value: string) {
    const [productId, variantId = ""] = value.split("|");
    setRequestLines((lines) => lines.map((line, lineIndex) => (
      lineIndex === index ? { ...line, productId, variantId } : line
    )));
  }

  function applyRuleSuggestion(rule: ReplenishmentRule) {
    const suggested = Math.max(0, rule.targetStock - rule.currentQuantity);
    setRequestStoreId(rule.storeId);
    setRequestWarehouseId(rule.preferredWarehouseId ?? "");
    setRequestLines([{ productId: rule.productId, variantId: rule.variantId ?? "", quantity: String(suggested || 1) }]);
    setRequestResult(null);
  }

  function receiptValue(requestId: string, line: SupplyChainRequest["lines"][number]) {
    return receiptDrafts[requestId]?.[line.id] ?? {
      receivedQuantity: String(Math.max(0, line.dispatchedQuantity - line.receivedQuantity - line.shortQuantity)),
      shortQuantity: "0",
      discrepancyNote: "",
    };
  }

  function updateReceiptValue(requestId: string, lineId: string, next: Partial<ReceiptDraft>, fallback: ReceiptDraft) {
    setReceiptDrafts((current) => ({
      ...current,
      [requestId]: {
        ...current[requestId],
        [lineId]: { ...(current[requestId]?.[lineId] ?? fallback), ...next },
      },
    }));
  }

  function submitWarehouse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createSupplyChainWarehouseAction({ storeId: warehouseStoreId, code: warehouseCode, name: warehouseName, notes: warehouseNotes });
      finish(result, setWarehouseResult);
      if (result.ok) {
        setWarehouseCode("");
        setWarehouseName("");
        setWarehouseNotes("");
      }
    });
  }

  function submitSupplierLeadTime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => finish(await updateSupplierLeadTimeAction({ supplierId, leadTimeDays }), setSupplierResult));
  }

  function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => finish(await upsertReplenishmentRuleAction({
      storeId: ruleStoreId,
      productId: ruleProductId,
      variantId: ruleVariantId,
      preferredWarehouseId: ruleWarehouseId,
      reorderPoint,
      targetStock,
    }), setRuleResult));
  }

  function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await createStockRequestAction({
        requestingStoreId: requestStoreId,
        sourceWarehouseId: requestWarehouseId,
        note: requestNote,
        lines: requestLines,
      });
      finish(result, setRequestResult);
      if (result.ok) {
        setRequestNote("");
        setRequestLines([emptyRequestLine(requestItems[0])]);
      }
    });
  }

  function approveRequest(request: SupplyChainRequest) {
    startTransition(async () => finishWorkflow(request.id, await approveStockRequestAction({
      stockRequestId: request.id,
      lines: request.lines.map((line) => ({ stockRequestLineId: line.id, approvedQuantity: String(line.requestedQuantity) })),
    })));
  }

  function startPicking(request: SupplyChainRequest) {
    startTransition(async () => finishWorkflow(request.id, await startStockRequestPickingAction({ stockRequestId: request.id })));
  }

  function dispatchRequest(request: SupplyChainRequest) {
    startTransition(async () => finishWorkflow(request.id, await dispatchStockRequestAction({
      stockRequestId: request.id,
      note: dispatchNotes[request.id] ?? "",
    })));
  }

  function receiveRequest(request: SupplyChainRequest) {
    const lines = request.lines
      .filter((line) => line.transferLineId)
      .map((line) => {
        const draft = receiptValue(request.id, line);
        return {
          stockTransferLineId: line.transferLineId,
          receivedQuantity: draft.receivedQuantity,
          shortQuantity: draft.shortQuantity,
          discrepancyNote: draft.discrepancyNote,
        };
      })
      .filter((line) => Number(line.receivedQuantity) + Number(line.shortQuantity) > 0);
    startTransition(async () => finishWorkflow(request.id, await receiveStockRequestAction({
      stockRequestId: request.id,
      note: receiptNotes[request.id] ?? "",
      lines,
    })));
  }

  return (
    <section className="space-y-6" aria-labelledby="replenishment-workflows-title">
      <div>
        <h2 className="text-lg font-semibold" id="replenishment-workflows-title">Supply chain and replenishment</h2>
        <p className="mt-1 text-sm text-muted-foreground">Requests are approved, picked, dispatched, and received as accountable stock movements.</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WorkflowCard icon={<Warehouse aria-hidden="true" />} title="Warehouse locations" description="Designate an existing store stock projection as a warehouse dispatch location.">
          {stores.length ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitWarehouse} noValidate>
            <Field label="Stock location"><select className={selectClassName} value={warehouseStoreId} onChange={(event) => setWarehouseStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
            <Field label="Warehouse code"><Input value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value.toUpperCase())} placeholder="CENTRAL" /></Field>
            <Field label="Warehouse name"><Input value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} placeholder="Central warehouse" /></Field>
            <Field label="Notes"><Input value={warehouseNotes} onChange={(event) => setWarehouseNotes(event.target.value)} placeholder="Optional dispatch note" /></Field>
            <div className="sm:col-span-2"><SubmitRow pending={isPending} result={warehouseResult} label="Create warehouse" icon={<Warehouse />} /></div>
          </form> : <Empty message="Create a store before designating a warehouse location." />}
          {warehouses.length ? <div className="mt-4 flex flex-wrap gap-2">{warehouses.map((warehouse) => <Badge key={warehouse.id} variant="secondary">{warehouse.code} · {warehouse.name}</Badge>)}</div> : null}
        </WorkflowCard>

        <WorkflowCard icon={<Truck aria-hidden="true" />} title="Supplier lead time" description="Record how many calendar days each supplier normally takes to deliver inbound stock.">
          {suppliers.length ? <form className="grid gap-3 sm:grid-cols-[1fr_8rem]" onSubmit={submitSupplierLeadTime} noValidate>
            <Field label="Supplier"><select className={selectClassName} value={supplierId} onChange={(event) => selectSupplier(event.target.value)}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></Field>
            <Field label="Lead time (days)"><Input inputMode="numeric" value={leadTimeDays} onChange={(event) => setLeadTimeDays(event.target.value)} /></Field>
            <div className="sm:col-span-2"><SubmitRow pending={isPending} result={supplierResult} label="Save lead time" icon={<Truck />} /></div>
          </form> : <Empty message="Add a supplier in Inventory before setting supplier lead time." />}
        </WorkflowCard>

        <WorkflowCard icon={<SlidersHorizontal aria-hidden="true" />} title="Reorder points & target stock" description="When a store reaches its reorder point, target stock determines the suggested request quantity.">
          {stores.length && ruleItems.length ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitRule} noValidate>
            <Field label="Store"><select className={selectClassName} value={ruleStoreId} onChange={(event) => setRuleStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
            <Field label="Tracked item"><select className={selectClassName} value={`${ruleProductId}|${ruleVariantId}`} onChange={(event) => selectRuleItem(event.target.value)}>{ruleItems.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.label}</option>)}</select></Field>
            <Field label="Preferred warehouse"><select className={selectClassName} value={ruleWarehouseId} onChange={(event) => setRuleWarehouseId(event.target.value)}><option value="">No preference</option>{eligibleRuleWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
            <Field label="Reorder point"><Input inputMode="decimal" value={reorderPoint} onChange={(event) => setReorderPoint(event.target.value)} /></Field>
            <Field label="Target stock"><Input inputMode="decimal" value={targetStock} onChange={(event) => setTargetStock(event.target.value)} /></Field>
            <div className="flex items-end"><Button disabled={isPending} type="submit">{isPending ? <LoaderCircle className="animate-spin" /> : <SlidersHorizontal />} Save rule</Button></div>
            <div className="sm:col-span-2"><ResultMessage result={ruleResult} /></div>
          </form> : <Empty message="Create a tracked item assigned to a store before setting reorder rules." />}
        </WorkflowCard>

        <WorkflowCard icon={<Send aria-hidden="true" />} title="Submit stock request" description="A request records demand only. Warehouse stock changes later, when the picked request is dispatched.">
          {stores.length && eligibleRequestWarehouses.length && requestItems.length ? <form className="space-y-3" onSubmit={submitRequest} noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Requesting store"><select className={selectClassName} value={requestStoreId} onChange={(event) => setRequestStoreId(event.target.value)}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
              <Field label="Source warehouse"><select className={selectClassName} value={requestWarehouseId} onChange={(event) => setRequestWarehouseId(event.target.value)}><option value="">Choose a warehouse</option>{eligibleRequestWarehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></Field>
            </div>
            <DraftRequestLines lines={requestLines} items={requestItems} onAdd={() => setRequestLines((lines) => [...lines, emptyRequestLine(requestItems[0])])} onChange={setRequestLines} onSelect={selectRequestItem} />
            <Field label="Request note"><Input value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Optional reason or delivery note" /></Field>
            <SubmitRow pending={isPending} result={requestResult} label="Submit for approval" icon={<Send />} />
          </form> : <Empty message="You need two stock locations, a designated warehouse, and a tracked item at the requesting store." />}
        </WorkflowCard>
      </div>

      <section className="space-y-3" aria-labelledby="reorder-watch-title">
        <div><h3 className="font-semibold" id="reorder-watch-title">Reorder watch</h3><p className="mt-1 text-sm text-muted-foreground">Suggested requests are based on current on-hand stock versus each target level.</p></div>
        {rules.length ? <div className="grid gap-3 lg:grid-cols-2">{rules.map((rule) => {
          const suggested = Math.max(0, rule.targetStock - rule.currentQuantity);
          const needsReorder = rule.currentQuantity <= rule.reorderPoint;
          return <Card key={rule.id} size="sm"><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4"><div><p className="font-medium">{rule.label}</p><p className="mt-1 text-xs text-muted-foreground">{rule.storeName} · on hand {formatQuantity(rule.currentQuantity)} {rule.unit} · reorder {formatQuantity(rule.reorderPoint)} · target {formatQuantity(rule.targetStock)}</p>{rule.warehouseName ? <p className="mt-1 text-xs text-muted-foreground">Preferred source: {rule.warehouseName}</p> : null}</div><div className="flex items-center gap-2"><Badge variant={needsReorder ? "secondary" : "outline"}>{needsReorder ? `Request ${formatQuantity(suggested)}` : "Above reorder point"}</Badge>{suggested > 0 ? <Button size="sm" type="button" variant="outline" onClick={() => applyRuleSuggestion(rule)}>Use suggestion</Button> : null}</div></CardContent></Card>;
        })}</div> : <Empty message="Save a reorder point and target stock rule to see replenishment suggestions." />}
      </section>

      <section className="space-y-3" aria-labelledby="inbound-stock-title">
        <div><h3 className="font-semibold" id="inbound-stock-title">Inbound stock</h3><p className="mt-1 text-sm text-muted-foreground">Open supplier orders remain inbound until their goods receipt is posted in Inventory.</p></div>
        {inboundPurchaseOrders.length ? <Card><CardContent className="divide-y px-0">{inboundPurchaseOrders.map((order) => <article className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" key={order.id}><div><p className="font-medium">PO #{order.orderNumber} · {order.supplierName}</p><p className="mt-1 text-xs text-muted-foreground">To {order.storeName} · {formatQuantity(order.remainingQuantity)} units remaining{order.expectedAt ? ` · expected ${formatDate(order.expectedAt)}` : ""}</p></div><Badge variant="outline">Inbound supplier stock</Badge></article>)}</CardContent></Card> : <Empty message="No open supplier purchase orders are currently inbound." />}
      </section>

      <section className="space-y-3" aria-labelledby="request-workflow-title">
        <div><h3 className="font-semibold" id="request-workflow-title">Stock request workflow</h3><p className="mt-1 text-sm text-muted-foreground">Approval and picking do not move stock. Dispatch moves it out; receiving adds only the quantities actually received.</p></div>
        {requests.length ? <div className="grid gap-4">{requests.map((request) => <StockRequestCard key={request.id} request={request} isPending={isPending} dispatchNote={dispatchNotes[request.id] ?? ""} receiptNote={receiptNotes[request.id] ?? ""} result={workflowResults[request.id] ?? null} onDispatchNote={(note) => setDispatchNotes((current) => ({ ...current, [request.id]: note }))} onReceiptNote={(note) => setReceiptNotes((current) => ({ ...current, [request.id]: note }))} receiptValue={receiptValue} onReceiptChange={updateReceiptValue} onApprove={() => approveRequest(request)} onStartPicking={() => startPicking(request)} onDispatch={() => dispatchRequest(request)} onReceive={() => receiveRequest(request)} />)}</div> : <Empty message="Submitted stock requests will appear here as they move through approval, picking, dispatch, and receiving." />}
      </section>
    </section>
  );
}

function StockRequestCard({ request, isPending, dispatchNote, receiptNote, result, onDispatchNote, onReceiptNote, receiptValue, onReceiptChange, onApprove, onStartPicking, onDispatch, onReceive }: {
  request: SupplyChainRequest;
  isPending: boolean;
  dispatchNote: string;
  receiptNote: string;
  result: Result | null;
  onDispatchNote: (note: string) => void;
  onReceiptNote: (note: string) => void;
  receiptValue: (requestId: string, line: SupplyChainRequest["lines"][number]) => ReceiptDraft;
  onReceiptChange: (requestId: string, lineId: string, next: Partial<ReceiptDraft>, fallback: ReceiptDraft) => void;
  onApprove: () => void;
  onStartPicking: () => void;
  onDispatch: () => void;
  onReceive: () => void;
}) {
  const canReceive = request.status === "dispatched" || request.status === "partially_received";
  return <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>Request #{request.requestNumber}</CardTitle><CardDescription className="mt-1">{request.warehouseName} → {request.requestingStoreName} · submitted {formatDate(request.requestedAt)}</CardDescription></div><Badge variant={request.status === "received_with_discrepancy" ? "secondary" : "outline"}>{statusLabel(request.status)}</Badge></CardHeader><CardContent className="space-y-4">
    {request.note ? <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">{request.note}</p> : null}
    <div className="divide-y rounded-lg border">{request.lines.map((line) => {
      const remaining = Math.max(0, line.dispatchedQuantity - line.receivedQuantity - line.shortQuantity);
      const draft = receiptValue(request.id, line);
      return <div className="grid gap-2 px-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center" key={line.id}><div><p className="font-medium">{line.label}</p><p className="mt-1 text-xs text-muted-foreground">Requested {formatQuantity(line.requestedQuantity)} · approved {formatQuantity(line.approvedQuantity)} · picked {formatQuantity(line.pickedQuantity)} · dispatched {formatQuantity(line.dispatchedQuantity)} · received {formatQuantity(line.receivedQuantity)}{line.shortQuantity ? ` · short ${formatQuantity(line.shortQuantity)}` : ""} {line.unit}</p></div>{canReceive && line.transferLineId && remaining > 0 ? <div className="grid gap-2 sm:grid-cols-3"><Field label="Received now"><Input inputMode="decimal" value={draft.receivedQuantity} onChange={(event) => onReceiptChange(request.id, line.id, { receivedQuantity: event.target.value }, draft)} /></Field><Field label="Short"><Input inputMode="decimal" value={draft.shortQuantity} onChange={(event) => onReceiptChange(request.id, line.id, { shortQuantity: event.target.value }, draft)} /></Field><Field label="Short reason"><Input value={draft.discrepancyNote} onChange={(event) => onReceiptChange(request.id, line.id, { discrepancyNote: event.target.value }, draft)} placeholder="If short" /></Field></div> : <span className="text-xs text-muted-foreground">{remaining > 0 ? `${formatQuantity(remaining)} awaiting dispatch` : "Accounted for"}</span>}</div>;
    })}</div>
    {request.status === "requested" ? <SubmitRow pending={isPending} result={result} label="Approve requested quantities" icon={<CheckCircle2 />} onClick={onApprove} /> : null}
    {request.status === "approved" ? <SubmitRow pending={isPending} result={result} label="Start picking" icon={<ClipboardCheck />} onClick={onStartPicking} /> : null}
    {request.status === "picking" ? <div className="space-y-3"><Field label="Dispatch note"><Input value={dispatchNote} onChange={(event) => onDispatchNote(event.target.value)} placeholder="Optional courier or packing note" /></Field><SubmitRow pending={isPending} result={result} label="Dispatch to in transit" icon={<Truck />} onClick={onDispatch} /></div> : null}
    {canReceive ? <div className="space-y-3"><Field label="Receipt note"><Input value={receiptNote} onChange={(event) => onReceiptNote(event.target.value)} placeholder="Optional delivery note" /></Field><SubmitRow pending={isPending} result={result} label="Record receipt / shortage" icon={<PackageCheck />} onClick={onReceive} /></div> : null}
  </CardContent></Card>;
}

function DraftRequestLines({ lines, items, onAdd, onChange, onSelect }: { lines: RequestDraft[]; items: SupplyChainItem[]; onAdd: () => void; onChange: (lines: RequestDraft[]) => void; onSelect: (index: number, value: string) => void }) {
  return <div className="space-y-2"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Requested items</p><Button size="sm" type="button" variant="outline" onClick={onAdd}><Plus /> Add item</Button></div>{lines.map((line, index) => <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" key={`${index}-${line.productId}-${line.variantId}`}><Field label="Item"><select className={selectClassName} value={`${line.productId}|${line.variantId}`} onChange={(event) => onSelect(index, event.target.value)}>{items.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.label}</option>)}</select></Field><Field label="Quantity"><Input inputMode="decimal" value={line.quantity} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, quantity: event.target.value } : current))} /></Field><Button aria-label="Remove requested item" disabled={lines.length === 1} size="sm" type="button" variant="ghost" onClick={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))}>Remove</Button></div>)}</div>;
}

function WorkflowCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return <Card><CardHeader className="flex-row items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">{icon}</span><div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div></CardHeader><CardContent>{children}</CardContent></Card>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}

function SubmitRow({ pending, result, label, icon, onClick }: { pending: boolean; result: Result | null; label: string; icon: ReactNode; onClick?: () => void }) {
  return <div className="flex flex-wrap items-center justify-between gap-3"><ResultMessage result={result} /><Button disabled={pending} type={onClick ? "button" : "submit"} onClick={onClick}>{pending ? <LoaderCircle className="animate-spin" /> : icon}{label}</Button></div>;
}

function ResultMessage({ result }: { result: Result | null }) {
  if (!result) return <span className="min-h-5 text-xs text-muted-foreground" />;
  return <p className={result.ok ? "text-xs text-primary" : "text-xs text-destructive"} role="status">{result.message}</p>;
}

function Empty({ message }: { message: string }) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{message}</p>;
}

function emptyRequestLine(item: SupplyChainItem | undefined): RequestDraft {
  return { productId: item?.productId ?? "", variantId: item?.variantId ?? "", quantity: "1" };
}

function itemKey(item: Pick<SupplyChainItem, "productId" | "variantId">) {
  return `${item.productId}|${item.variantId ?? ""}`;
}

function statusLabel(status: SupplyChainRequest["status"]) {
  return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(new Date(value));
}
