"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  ClipboardCheck,
  Download,
  LoaderCircle,
  PackageCheck,
  Pencil,
  Plus,
  SendHorizontal,
  Trash2,
  Truck,
  Upload,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { GuardedDeleteDialog } from "@/components/back-office/guarded-delete-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestManagerApprovalAction } from "@/features/approvals/actions";
import { ManagerApprovalDialog } from "@/features/approvals/manager-approval-dialog";
import {
  cancelPurchaseOrderAction,
  completeInventoryCountAction,
  createPurchaseOrderAction,
  createSupplierAction,
  receivePurchaseOrderAction,
  transferStockAction,
  updateSupplierAction,
  importInventoryAdjustmentsCsvAction,
} from "@/features/inventory/advanced-inventory-actions";
import { SupplierCsvTools } from "@/features/inventory/supplier-csv-tools";
import {
  clearInventoryOperationId as clearPendingOperation,
  getInventoryOperationId as pendingOperationId,
} from "@/features/inventory/inventory-operation-id";
import { parseCsvRecords, csvRows } from "@/lib/csv";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type AdvancedInventoryItem = {
  productId: string;
  variantId: string | null;
  label: string;
  unit: string;
  storeIds: string[];
  quantitiesByStore: Record<string, number>;
  identifiers: string[];
  purchaseUnits: Array<{ code: string; factorToBase: number; name: string }>;
};

export type AdvancedInventorySupplier = {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
};

export type AdvancedPurchaseOrder = {
  id: string;
  orderNumber: number;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  supplierName: string;
  storeName: string;
  expectedAt: string | null;
  createdAt: string;
  totalCostMinor: number;
  lines: Array<{
    id: string;
    label: string;
    unit: string;
    orderedQuantity: number;
    receivedQuantity: number;
    unitCostMinor: number;
  }>;
};

export type AdvancedGoodsReceipt = {
  id: string;
  lines: Array<{ label: string; quantity: number; unit: string }>;
  note: string | null;
  purchaseOrderId: string;
  purchaseOrderNumber: number;
  receiptNumber: number;
  receivedAt: string;
  storeName: string;
};

type StoreOption = { id: string; name: string };
type SaleableDraft = { productId: string; variantId: string; quantity: string };
type PurchaseDraft = SaleableDraft & { purchaseUnitCode: string; unitCost: string };
type CountDraft = { productId: string; variantId: string; countedQuantity: string };
type CountReview = {
  lines: Array<{
    countedQuantity: number;
    difference: number;
    expectedQuantity: number;
    label: string;
    productId: string;
    unit: string;
    variantId: string;
  }>;
  note: string;
  storeId: string;
  storeName: string;
};
type SupplierDraft = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
};
type WorkflowResult = { ok: boolean; message: string };
export type AdvancedInventorySection = "purchasing" | "counts" | "transfers";

const ALL_ADVANCED_INVENTORY_SECTIONS: readonly AdvancedInventorySection[] = [
  "purchasing",
  "counts",
  "transfers",
];

export function AdvancedInventoryWorkflows({
  stores,
  items,
  suppliers,
  purchaseOrders,
  receipts,
  currencyCode,
  canCreatePurchaseOrders = false,
  canManageSuppliers = false,
  canReceivePurchaseOrders = false,
  canUseLegacyCsvTools = false,
  canViewCosts,
  adjustmentReasons,
  initialPurchasingSection = "orders",
  initialReceiptOrderId,
  receivingHref,
  showHeader = true,
  showPurchasingTabs = true,
  sections = ALL_ADVANCED_INVENTORY_SECTIONS,
}: {
  stores: StoreOption[];
  items: AdvancedInventoryItem[];
  suppliers: AdvancedInventorySupplier[];
  purchaseOrders: AdvancedPurchaseOrder[];
  receipts?: AdvancedGoodsReceipt[];
  currencyCode: string;
  canCreatePurchaseOrders?: boolean;
  canManageSuppliers?: boolean;
  canReceivePurchaseOrders?: boolean;
  /** The retained combined CSV tool remains manager-only until its planned replacement. */
  canUseLegacyCsvTools?: boolean;
  canViewCosts?: boolean;
  adjustmentReasons: Array<{ code: string; name: string }>;
  /** Lets Inventory Control deep-link to one purchasing workflow without duplicating it. */
  initialPurchasingSection?: "orders" | "receiving" | "suppliers";
  /** Keeps a contextual PO → Receiving handoff in the canonical query-driven workspace. */
  initialReceiptOrderId?: string | null;
  receivingHref?: string;
  /** The parent workspace already supplies the H1 and purpose when embedded. */
  showHeader?: boolean;
  /** The shared Inventory navigation owns the top-level purchasing destinations. */
  showPurchasingTabs?: boolean;
  sections?: readonly AdvancedInventorySection[];
}) {
  const router = useRouter();
  const [pendingActions, setPendingActions] = useState<Set<string>>(() => new Set());
  const [supplier, setSupplier] = useState<SupplierDraft>({
    name: "",
    contactName: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });
  const [supplierResult, setSupplierResult] = useState<WorkflowResult | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<WorkflowResult | null>(null);
  const [receiptResult, setReceiptResult] = useState<WorkflowResult | null>(null);
  const [purchasingSection, setPurchasingSection] = useState<"orders" | "receiving" | "suppliers">(initialPurchasingSection);
  const [countResult, setCountResult] = useState<WorkflowResult | null>(null);
  const [transferResult, setTransferResult] = useState<WorkflowResult | null>(null);

  const firstStoreId = stores[0]?.id ?? "";
  const firstItem = items[0];
  const emptyPurchaseLine = (): PurchaseDraft => ({
    productId: firstItem?.productId ?? "",
    variantId: firstItem?.variantId ?? "",
    purchaseUnitCode: firstItem?.purchaseUnits[0]?.code ?? "",
    quantity: "1",
    unitCost: "0.00",
  });
  const emptyCountLine = (): CountDraft => ({
    productId: firstItem?.productId ?? "",
    variantId: firstItem?.variantId ?? "",
    countedQuantity: "0",
  });
  const emptyTransferLine = (): SaleableDraft => ({
    productId: firstItem?.productId ?? "",
    variantId: firstItem?.variantId ?? "",
    quantity: "1",
  });

  const [purchaseStoreId, setPurchaseStoreId] = useState(firstStoreId);
  const [purchaseSupplierId, setPurchaseSupplierId] = useState(suppliers[0]?.id ?? "");
  const [purchaseExpectedAt, setPurchaseExpectedAt] = useState("");
  const [purchaseNotes, setPurchaseNotes] = useState("");
  const [purchaseLines, setPurchaseLines] = useState<PurchaseDraft[]>([emptyPurchaseLine()]);
  const receivableOrders = purchaseOrders
    .filter((order) => order.status === "ordered" || order.status === "partially_received")
    .map((order) => ({
      ...order,
      lines: order.lines.filter((line) => line.receivedQuantity < line.orderedQuantity),
    }))
    .filter((order) => order.lines.length > 0);
  const initialReceiptOrder = receivableOrders.find((order) => order.id === initialReceiptOrderId) ?? receivableOrders[0];
  const [receiptOrderId, setReceiptOrderId] = useState(initialReceiptOrder?.id ?? "");
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>(() =>
    receiptDraft(initialReceiptOrder),
  );
  const [countStoreId, setCountStoreId] = useState(firstStoreId);
  const [countNote, setCountNote] = useState("");
  const [countLines, setCountLines] = useState<CountDraft[]>([emptyCountLine()]);
  const [countReview, setCountReview] = useState<CountReview | null>(null);
  const [sourceStoreId, setSourceStoreId] = useState(firstStoreId);
  const [destinationStoreId, setDestinationStoreId] = useState(stores[1]?.id ?? "");
  const [transferNote, setTransferNote] = useState("");
  const [transferLines, setTransferLines] = useState<SaleableDraft[]>([emptyTransferLine()]);

  const isActionPending = (action: string) => pendingActions.has(action);
  const runAction = async (action: string, work: () => Promise<void>) => {
    setPendingActions((current) => new Set(current).add(action));
    try {
      await work();
    } finally {
      setPendingActions((current) => {
        const next = new Set(current);
        next.delete(action);
        return next;
      });
    }
  };

  const activeSuppliers = suppliers.filter((supplierOption) => supplierOption.isActive);
  const purchasableItems = useMemo(
    () => items.filter((item) => item.storeIds.includes(purchaseStoreId)),
    [items, purchaseStoreId],
  );
  const countableItems = useMemo(
    () => items.filter((item) => item.storeIds.includes(countStoreId)),
    [items, countStoreId],
  );
  const transferableItems = useMemo(
    () => items.filter((item) => item.storeIds.includes(sourceStoreId)),
    [items, sourceStoreId],
  );
  const selectedReceiptOrder = receivableOrders.find((order) => order.id === receiptOrderId);
  const showPurchasing = sections.includes("purchasing");
  const showCounts = sections.includes("counts");
  const showTransfers = sections.includes("transfers");
  const title = sections.length === 1
    ? sections[0] === "purchasing"
      ? "Purchasing"
      : sections[0] === "counts"
        ? "Inventory counts"
        : "Stock transfers"
    : "Inventory operations";
  const description = sections.length === 1
    ? sections[0] === "purchasing"
      ? purchasingSection === "receiving"
        ? "Record what physically arrived from a purchase order. Receiving is the bridge from procurement to the inventory ledger."
        : "Manage suppliers, purchase orders, deliveries, and procurement costs. Purchase orders record buying intent; only receiving changes stock."
      : sections[0] === "counts"
        ? "Count what you physically have, review the difference, then record the verified correction."
        : "Prepare stock transfers between stores and review the details before sending them."
    : "Order from suppliers, receive goods, count stock, and move items between stores.";

  function finish(result: WorkflowResult, setResult: (value: WorkflowResult) => void) {
    setResult(result);
    if (result.ok) router.refresh();
  }

  function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSupplierResult(null);
    void runAction("supplier", async () => {
      const result = await createSupplierAction(supplier);
      finish(result, setSupplierResult);
      if (result.ok) {
        setSupplier({ name: "", contactName: "", email: "", phone: "", address: "", notes: "" });
        setPurchaseSupplierId(result.data?.supplierId ?? "");
      }
    });
  }

  function submitPurchaseOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPurchaseResult(null);
    void runAction("purchase", async () => {
      const operationScope = "purchase-order";
      const result = await createPurchaseOrderAction({
        operationId: pendingOperationId(operationScope),
        storeId: purchaseStoreId,
        supplierId: purchaseSupplierId,
        expectedAt: purchaseExpectedAt,
        notes: purchaseNotes,
        lines: purchaseLines,
      });
      finish(result, setPurchaseResult);
      if (result.ok) {
        clearPendingOperation(operationScope);
        setPurchaseNotes("");
        setPurchaseExpectedAt("");
        setPurchaseLines([emptyPurchaseLine()]);
      }
    });
  }

  function chooseReceiptOrder(orderId: string) {
    const order = purchaseOrders.find((candidate) => candidate.id === orderId);
    setReceiptOrderId(orderId);
    setReceiptQuantities(receiptDraft(order));
  }

  function submitReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReceiptOrder) return;
    setReceiptResult(null);
    void runAction("receipt", async () => {
      const operationScope = `goods-receipt:${selectedReceiptOrder.id}`;
      const result = await receivePurchaseOrderAction({
        operationId: pendingOperationId(operationScope),
        purchaseOrderId: selectedReceiptOrder.id,
        note: receiptNote,
        lines: selectedReceiptOrder.lines
          .map((line) => ({ purchaseOrderLineId: line.id, quantity: receiptQuantities[line.id] ?? "" }))
          .filter((line) => Number(line.quantity) > 0),
      });
      finish(result, setReceiptResult);
      if (result.ok) {
        clearPendingOperation(operationScope);
        setReceiptNote("");
      }
    });
  }

  function reviewCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCountResult(null);
    const store = stores.find((candidate) => candidate.id === countStoreId);
    const seenItems = new Set<string>();
    const reviewLines: CountReview["lines"] = [];

    if (!store) {
      setCountReview(null);
      setCountResult({ ok: false, message: "Choose a valid store before reviewing." });
      return;
    }

    for (const line of countLines) {
      const item = findItem(countableItems, line);
      const countedQuantity = Number(line.countedQuantity);
      const itemKey = `${line.productId}|${line.variantId}`;

      if (!item || !/^\d{1,8}(?:\.\d{1,3})?$/.test(line.countedQuantity) || !Number.isFinite(countedQuantity) || countedQuantity < 0 || seenItems.has(itemKey)) {
        setCountReview(null);
        setCountResult({ ok: false, message: "Choose unique counted items and enter non-negative quantities with up to 3 decimals before reviewing." });
        return;
      }

      seenItems.add(itemKey);
      const expectedQuantity = item.quantitiesByStore[countStoreId] ?? 0;
      reviewLines.push({
        countedQuantity,
        difference: countedQuantity - expectedQuantity,
        expectedQuantity,
        label: item.label,
        productId: line.productId,
        unit: item.unit,
        variantId: line.variantId,
      });
    }

    setCountReview({ storeId: countStoreId, storeName: store.name, note: countNote, lines: reviewLines });
  }

  function submitReviewedCount() {
    if (!countReview) return;
    void runAction("count", async () => {
      const result = await completeInventoryCountAction({
        storeId: countReview.storeId,
        note: countReview.note,
        lines: countReview.lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          countedQuantity: String(line.countedQuantity),
        })),
      });
      finish(result, setCountResult);
      if (result.ok) {
        setCountNote("");
        setCountLines([emptyCountLine()]);
        setCountReview(null);
      }
    });
  }

  function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferResult(null);
    void runAction("transfer", async () => {
      const payload = {
        sourceStoreId,
        destinationStoreId,
        note: transferNote,
        lines: transferLines,
      };
      const operationScope = "direct-stock-transfer";
      const result = await transferStockAction({
        ...payload,
        operationId: pendingOperationId(operationScope, payload),
      });
      finish(result, setTransferResult);
      if (result.ok) {
        clearPendingOperation(operationScope);
        setTransferNote("");
        setTransferLines([emptyTransferLine()]);
      }
    });
  }

  return (
    <section
      aria-label={showHeader ? undefined : "Purchasing operations"}
      aria-labelledby={showHeader ? "advanced-inventory-title" : undefined}
      className="space-y-4"
    >
      {showHeader ? <div>
        <h2 className="text-lg font-semibold" id="advanced-inventory-title">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      </div> : null}

      {/* CANDIDATE_FOR_REMOVAL: retained as the component's standalone fallback; the shared Inventory navigation now owns these destinations. */}
      {showPurchasing && showPurchasingTabs ? (
        <PurchasingSectionTabs activeSection={purchasingSection} onChange={setPurchasingSection} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {showPurchasing && purchasingSection === "suppliers" ? <>
          {canManageSuppliers ? <SupplierCsvTools /> : null}
        <WorkflowCard
          title="Supplier management"
          description="Keep procurement contacts available for every purchase order."
          icon={<UserPlus aria-hidden="true" />}
        >
          {canManageSuppliers ? <Dialog.Root>
            <DialogTrigger render={<Button type="button" />}>
              <UserPlus />
              Add supplier
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add supplier</DialogTitle>
                <DialogDescription>
                  Save a supplier contact for use in future purchase orders.
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={submitSupplier} noValidate>
            <Field label="Supplier name">
              <Input
                value={supplier.name}
                onChange={(event) => setSupplier({ ...supplier, name: event.target.value })}
                placeholder="Metro Wholesale"
              />
            </Field>
            <Field label="Contact name">
              <Input
                value={supplier.contactName}
                onChange={(event) => setSupplier({ ...supplier, contactName: event.target.value })}
                placeholder="Alex Santos"
              />
            </Field>
            <Field label="Email">
              <Input
                value={supplier.email}
                onChange={(event) => setSupplier({ ...supplier, email: event.target.value })}
                inputMode="email"
                placeholder="orders@example.com"
              />
            </Field>
            <Field label="Phone">
              <Input
                value={supplier.phone}
                onChange={(event) => setSupplier({ ...supplier, phone: event.target.value })}
                placeholder="0917 000 0000"
              />
            </Field>
            <Field className="sm:col-span-2" label="Address">
              <Input
                value={supplier.address}
                onChange={(event) => setSupplier({ ...supplier, address: event.target.value })}
                placeholder="Optional delivery address"
              />
            </Field>
            <Field className="sm:col-span-2" label="Notes">
              <Input
                value={supplier.notes}
                onChange={(event) => setSupplier({ ...supplier, notes: event.target.value })}
                placeholder="Optional ordering notes"
              />
            </Field>
            <DialogFooter className="sm:col-span-2">
              <ResultMessage result={supplierResult} />
              <Button disabled={isActionPending("supplier")} type="submit">
                {isActionPending("supplier") ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
                Save supplier
              </Button>
            </DialogFooter>
          </form>
              </DialogBody>
            </DialogContent>
          </Dialog.Root> : <p className="text-sm text-muted-foreground">You can review suppliers, but supplier changes require the supplier-management permission.</p>}
          {suppliers.length > 0 ? (
            <div className="mt-5 space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Suppliers</p>
              {suppliers.map((supplierOption) => (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3" key={supplierOption.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{supplierOption.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {supplierOption.contactName || supplierOption.email || supplierOption.phone || "No contact details"}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={supplierOption.isActive ? "text-xs text-primary" : "text-xs text-muted-foreground"}>
                      {supplierOption.isActive ? "Active" : "Inactive"}
                    </span>
                    {canManageSuppliers ? <EditSupplierDialog supplier={supplierOption} /> : null}
                    {canManageSuppliers && !supplierOption.isActive ? (
                      <GuardedDeleteDialog
                        recordId={supplierOption.id}
                        recordName={supplierOption.name}
                        recordType="supplier"
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </WorkflowCard>
        </> : null}

        {showPurchasing && purchasingSection === "orders" ? <>
        <PurchaseOrdersCard
          canCancel={canCreatePurchaseOrders}
          canReceive={canReceivePurchaseOrders}
          canViewCosts={Boolean(canViewCosts)}
          currencyCode={currencyCode}
          orders={purchaseOrders}
          onReceive={(order) => {
            if (receivingHref) {
              router.push(`${receivingHref}&purchaseOrder=${encodeURIComponent(order.id)}`);
              return;
            }
            setReceiptOrderId(order.id);
            setReceiptQuantities(receiptDraft(order));
            setPurchasingSection("receiving");
          }}
        />
        {canCreatePurchaseOrders ? <WorkflowCard
          title="Create purchase order"
          description="1. Choose the supplier and store. 2. Add expected items. 3. Review, then create the order."
          icon={<Truck aria-hidden="true" />}
        >
          {canViewCosts && activeSuppliers.length > 0 && stores.length > 0 && items.length > 0 ? (
            <form className="space-y-3" onSubmit={submitPurchaseOrder} noValidate>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Receiving store">
                  <select
                    className={selectClassName}
                    value={purchaseStoreId}
                    onChange={(event) => setPurchaseStoreId(event.target.value)}
                  >
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </Field>
                <Field label="Supplier">
                  <select
                    className={selectClassName}
                    value={purchaseSupplierId}
                    onChange={(event) => setPurchaseSupplierId(event.target.value)}
                  >
                    {activeSuppliers.map((supplierOption) => (
                      <option key={supplierOption.id} value={supplierOption.id}>{supplierOption.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Expected date">
                  <Input type="date" value={purchaseExpectedAt} onChange={(event) => setPurchaseExpectedAt(event.target.value)} />
                </Field>
              </div>
              <DraftPurchaseLines
                lines={purchaseLines}
                items={purchasableItems}
                currencyCode={currencyCode}
                onChange={setPurchaseLines}
                onAdd={emptyPurchaseLine}
              />
              <Field label="Notes">
                <Input value={purchaseNotes} onChange={(event) => setPurchaseNotes(event.target.value)} placeholder="Optional supplier instructions" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <ResultMessage result={purchaseResult} />
                <Button disabled={isActionPending("purchase") || purchasableItems.length === 0} type="submit">
                  {isActionPending("purchase") ? <LoaderCircle className="animate-spin" /> : <Truck />}
                  Create order
                </Button>
              </div>
            </form>
          ) : canViewCosts ? (
            <EmptyWorkflow message="Add an active supplier, store, and tracked item before creating a purchase order." />
          ) : (
            <EmptyWorkflow message="Purchase-order creation requires the existing cost-view permission." />
          )}
        </WorkflowCard> : null}
        {canUseLegacyCsvTools && canViewCosts ? <details className="xl:col-span-2 rounded-xl border bg-card"><summary className="cursor-pointer px-4 py-3 text-sm font-medium">Import inventory records</summary><div className="border-t p-4"><InventoryCsvTools stores={stores} items={items} suppliers={activeSuppliers} adjustmentReasons={adjustmentReasons} /></div></details> : null}
        </> : null}

        {showPurchasing && purchasingSection === "receiving" ? <>
        {canReceivePurchaseOrders ? <WorkflowCard
          title="Receive purchase order"
          description="1. Choose the open order. 2. Enter what arrived. 3. Review the quantities, then record the receipt."
          icon={<PackageCheck aria-hidden="true" />}
        >
          {receivableOrders.length > 0 ? (
            <form className="space-y-3" onSubmit={submitReceipt} noValidate>
              <Field label="Open purchase order">
                <select
                  className={selectClassName}
                  value={receiptOrderId}
                  onChange={(event) => chooseReceiptOrder(event.target.value)}
                >
                  {receivableOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      PO #{order.orderNumber} · {order.supplierName} · {order.storeName}
                    </option>
                  ))}
                </select>
              </Field>
              {selectedReceiptOrder?.lines.map((line) => {
                const remaining = line.orderedQuantity - line.receivedQuantity;
                return (
                  <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_9rem] sm:items-end" key={line.id}>
                    <div>
                      <p className="font-medium">{line.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatQuantity(remaining)} {line.unit} remaining{canViewCosts ? ` · ${formatMoney(line.unitCostMinor, currencyCode)} each` : ""}
                      </p>
                    </div>
                    <Field label="Receive now">
                      <Input
                        inputMode="decimal"
                        value={receiptQuantities[line.id] ?? ""}
                        onChange={(event) => setReceiptQuantities({ ...receiptQuantities, [line.id]: event.target.value })}
                      />
                    </Field>
                  </div>
                );
              })}
              <Field label="Receipt note">
                <Input value={receiptNote} onChange={(event) => setReceiptNote(event.target.value)} placeholder="Optional delivery note" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <ResultMessage result={receiptResult} />
                <Button disabled={isActionPending("receipt")} type="submit">
                  {isActionPending("receipt") ? <LoaderCircle className="animate-spin" /> : <PackageCheck />}
                  Receive goods
                </Button>
              </div>
            </form>
          ) : (
            <EmptyWorkflow message="Open purchase orders will be available here for partial or complete receiving." />
          )}
        </WorkflowCard> : null}
        <RecentReceiptsCard receipts={receipts ?? []} />
        </> : null}

        {showCounts ? <WorkflowCard
          title="Complete inventory count"
          description="1. Choose a store. 2. Enter what you physically counted. 3. Review the difference before recording it."
          icon={<ClipboardCheck aria-hidden="true" />}
        >
          {stores.length > 0 && items.length > 0 ? (
            <>
            <form className="space-y-3" onSubmit={reviewCount} noValidate>
              <Field label="Store">
                <select className={selectClassName} value={countStoreId} onChange={(event) => { setCountStoreId(event.target.value); setCountReview(null); }}>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </Field>
              <DraftCountLines
                lines={countLines}
                items={countableItems}
                storeId={countStoreId}
                onChange={(lines) => { setCountLines(lines); setCountReview(null); }}
                onAdd={emptyCountLine}
              />
              <Field label="Count note">
                <Input value={countNote} onChange={(event) => { setCountNote(event.target.value); setCountReview(null); }} placeholder="Optional count reason" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <ResultMessage result={countResult} />
                <Button disabled={isActionPending("count") || countableItems.length === 0} type="submit">
                  {isActionPending("count") ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}
                  Review count
                </Button>
              </div>
            </form>
            {countReview ? <CountReviewCard pending={isActionPending("count")} review={countReview} onBack={() => setCountReview(null)} onPost={submitReviewedCount} /> : null}
            </>
          ) : (
            <EmptyWorkflow message="Create a tracked item in a store before counting inventory." />
          )}
        </WorkflowCard> : null}

        {/* CANDIDATE_FOR_REMOVAL: the shared Transfers tab now owns the
            canonical direct-transfer UI. Retain this standalone form until
            historical callers and QA confirm it is no longer referenced. */}
        {showTransfers ? <WorkflowCard
          title="Transfer stock"
          description="Choose the source and destination, add items, then review the transfer before it is recorded."
          icon={<SendHorizontal aria-hidden="true" />}
        >
          {stores.length > 1 && items.length > 0 ? (
            <form className="space-y-3" onSubmit={submitTransfer} noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="From store">
                  <select className={selectClassName} value={sourceStoreId} onChange={(event) => setSourceStoreId(event.target.value)}>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </Field>
                <Field label="To store">
                  <select className={selectClassName} value={destinationStoreId} onChange={(event) => setDestinationStoreId(event.target.value)}>
                    {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                  </select>
                </Field>
              </div>
              <DraftTransferLines
                lines={transferLines}
                items={transferableItems}
                storeId={sourceStoreId}
                onChange={setTransferLines}
                onAdd={emptyTransferLine}
              />
              <Field label="Transfer note">
                <Input value={transferNote} onChange={(event) => setTransferNote(event.target.value)} placeholder="Optional transfer note" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <ResultMessage result={transferResult} />
                <Button disabled={isActionPending("transfer") || transferableItems.length === 0} type="submit">
                  {isActionPending("transfer") ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}
                  Transfer stock
                </Button>
              </div>
            </form>
          ) : (
            <EmptyWorkflow message="At least two stores and one tracked item are required for stock transfers." />
          )}
        </WorkflowCard> : null}
      </div>
    </section>
  );
}

type InventoryCsvKind = "count" | "purchase" | "adjustment";
type InventoryCsvRow = { rowNumber: number; itemCode: string; productId: string; variantId: string; purchaseUnitCode: string; quantity: string; unitCost: string; note: string };

function InventoryCsvTools({
  stores, items, suppliers, adjustmentReasons,
}: {
  stores: StoreOption[];
  items: AdvancedInventoryItem[];
  suppliers: AdvancedInventorySupplier[];
  adjustmentReasons: Array<{ code: string; name: string }>;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<InventoryCsvKind>("count");
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [reasonCode, setReasonCode] = useState(adjustmentReasons[0]?.code ?? "");
  const [note, setNote] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [rows, setRows] = useState<InventoryCsvRow[]>([]);
  const [filename, setFilename] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [adjustmentApprovalRequestId, setAdjustmentApprovalRequestId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const headers = kind === "count" ? ["item_code", "counted_quantity"] : kind === "purchase" ? ["item_code", "quantity", "unit_cost"] : ["item_code", "quantity_delta", "note"];

  function downloadTemplate() {
    const sample = kind === "count" ? ["YOUR-SKU-OR-BARCODE", "12"] : kind === "purchase" ? ["YOUR-SKU-OR-BARCODE", "12", "45.00"] : ["YOUR-SKU-OR-BARCODE", "-2", "Damaged during delivery"];
    const blob = new Blob([csvRows([headers, sample])], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `tindio-${kind}-import-template.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  async function chooseFile(file: File | undefined) {
    setRows([]); setErrors([]); setResult(null); setFilename(file?.name ?? ""); setAdjustmentApprovalRequestId(null);
    if (!file) return;
    if (file.size > 1024 * 1024) { setErrors(["Choose a CSV file smaller than 1 MB."]); return; }
    const records = parseCsvRecords(await file.text()); if (typeof records === "string") { setErrors([records]); return; }
    if (records.length < 2) { setErrors(["Add a header row and at least one data row."]); return; }
    const actualHeaders = records[0].map((value) => value.trim().toLowerCase());
    const missing = headers.filter((header) => !actualHeaders.includes(header));
    if (missing.length || new Set(actualHeaders).size !== actualHeaders.length) { setErrors([missing.length ? `Missing required CSV columns: ${missing.join(", ")}.` : "CSV headers must not repeat."]); return; }
    const positions = new Map(actualHeaders.map((header, index) => [header, index])); const cell = (record: string[], header: string) => record[positions.get(header) ?? -1]?.trim() ?? "";
    const errors: string[] = []; const parsedRows: InventoryCsvRow[] = [];
    records.slice(1).forEach((record, index) => {
      const rowNumber = index + 2; if (record.every((value) => !value.trim())) return;
      const itemCode = cell(record, "item_code"); const matches = items.filter((item) => item.identifiers.some((identifier) => identifier.toLowerCase() === itemCode.toLowerCase()));
      const quantity = kind === "count" ? cell(record, "counted_quantity") : kind === "adjustment" ? cell(record, "quantity_delta") : cell(record, "quantity"); const unitCost = cell(record, "unit_cost"); const rowNote = cell(record, "note");
      if (!itemCode || matches.length !== 1) errors.push(`Row ${rowNumber}: item_code must match exactly one active SKU or barcode.`);
      if (kind === "count" && !/^\d{1,8}(?:\.\d{1,3})?$/.test(quantity)) errors.push(`Row ${rowNumber}: counted_quantity must be non-negative with up to 3 decimals.`);
      if (kind === "purchase" && (!/^\d{1,8}(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || !/^\d{1,8}(?:\.\d{1,2})?$/.test(unitCost))) errors.push(`Row ${rowNumber}: quantity and unit_cost must be valid positive values.`);
      if (kind === "adjustment" && (!/^-?\d{1,8}(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) === 0)) errors.push(`Row ${rowNumber}: quantity_delta must be non-zero with up to 3 decimals.`);
      if (kind === "adjustment" && (rowNote.length < 2 || rowNote.length > 500)) errors.push(`Row ${rowNumber}: note must explain the adjustment in 2–500 characters.`);
      if (!itemCode || matches.length !== 1 || (kind === "count" && !/^\d{1,8}(?:\.\d{1,3})?$/.test(quantity)) || (kind === "purchase" && (!/^\d{1,8}(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || !/^\d{1,8}(?:\.\d{1,2})?$/.test(unitCost))) || (kind === "adjustment" && (!/^-?\d{1,8}(?:\.\d{1,3})?$/.test(quantity) || Number(quantity) === 0 || rowNote.length < 2 || rowNote.length > 500))) return;
      parsedRows.push({ rowNumber, itemCode, productId: matches[0].productId, variantId: matches[0].variantId ?? "", purchaseUnitCode: matches[0].purchaseUnits[0]?.code ?? "", quantity, unitCost, note: rowNote });
    });
    if (parsedRows.length > 500) errors.push("Import at most 500 rows at a time."); if (!parsedRows.length && !errors.length) errors.push("Add at least one data row.");
    if (errors.length) { setErrors(errors); return; } setRows(parsedRows);
  }

  function adjustmentImportPayload() {
    return {
      storeId,
      reasonCode,
      rows: rows.map((row) => ({
        rowNumber: row.rowNumber,
        productId: row.productId,
        variantId: row.variantId,
        quantityDelta: row.quantity,
        note: row.note,
      })),
    };
  }

  function adjustmentApprovalPayload(operationId: string) {
    return {
      store_id: storeId,
      reason_code: reasonCode,
      operation_id: operationId,
      rows: rows.map((row) => ({
        row_number: row.rowNumber,
        product_id: row.productId,
        variant_id: row.variantId || null,
        quantity_delta: Number(row.quantity),
        note: row.note.trim(),
      })),
    };
  }

  async function executeAdjustmentImport(approvalRequestId: string | null) {
    const payload = adjustmentImportPayload();
    const operationScope = "inventory-adjustment:csv-import";
    const response = await importInventoryAdjustmentsCsvAction({
      ...payload,
      operationId: pendingOperationId(operationScope, payload),
      approvalRequestId,
    });
    setResult(response.message);
    if (response.ok) {
      clearPendingOperation(operationScope);
      setAdjustmentApprovalRequestId(null);
      setRows([]);
      setFilename("");
      router.refresh();
    }
  }

  function confirmImport() {
    setResult(null);
    startTransition(async () => {
      if (kind === "adjustment") {
        const payload = adjustmentImportPayload();
        const operationId = pendingOperationId("inventory-adjustment:csv-import", payload);
        const approval = await requestManagerApprovalAction({
          operationCode: "inventory.adjust",
          reason: `CSV inventory adjustment import: ${rows.length} row${rows.length === 1 ? "" : "s"}.`,
          payload: adjustmentApprovalPayload(operationId),
        });
        if (!approval.ok) {
          setResult(approval.message);
          return;
        }
        if (approval.decision === "APPROVAL_REQUIRED") {
          setAdjustmentApprovalRequestId(approval.data.approvalRequestId);
          setResult(approval.message);
          return;
        }
        await executeAdjustmentImport(null);
        return;
      }

      const operationScope = "purchase-order-import";
      const response = kind === "count"
        ? await completeInventoryCountAction({ storeId, note, lines: rows.map((row) => ({ productId: row.productId, variantId: row.variantId, countedQuantity: row.quantity })) })
        : await createPurchaseOrderAction({ operationId: pendingOperationId(operationScope), storeId, supplierId, expectedAt, notes: note, lines: rows.map((row) => ({ productId: row.productId, variantId: row.variantId, purchaseUnitCode: row.purchaseUnitCode, quantity: row.quantity, unitCost: row.unitCost })) });
      setResult(response.message);
      if (response.ok) {
        if (kind === "purchase") clearPendingOperation(operationScope);
        setRows([]);
        setFilename("");
        router.refresh();
      }
    });
  }

  return <>
    <Card>
      <CardHeader><CardTitle>Inventory CSV</CardTitle><CardDescription>Preview and confirm one controlled inventory operation. This never writes stock projections directly.</CardDescription></CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Operation<select className={selectClassName} onChange={(event) => { setKind(event.target.value as InventoryCsvKind); setRows([]); setErrors([]); setFilename(""); setAdjustmentApprovalRequestId(null); }} value={kind}><option value="count">Complete inventory count</option><option value="purchase">Create purchase order</option><option value="adjustment">Post stock adjustments</option></select></label>
          <label className="grid gap-1 text-sm font-medium">Store<select className={selectClassName} onChange={(event) => { setStoreId(event.target.value); setAdjustmentApprovalRequestId(null); }} value={storeId}>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
        </div>
        {kind === "purchase" ? <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-medium">Supplier<select className={selectClassName} onChange={(event) => setSupplierId(event.target.value)} value={supplierId}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label className="grid gap-1 text-sm font-medium">Expected date<Input onChange={(event) => setExpectedAt(event.target.value)} type="date" value={expectedAt} /></label></div> : null}
        {kind === "adjustment" ? <label className="grid gap-1 text-sm font-medium">Adjustment reason<select className={selectClassName} onChange={(event) => { setReasonCode(event.target.value); setAdjustmentApprovalRequestId(null); }} value={reasonCode}>{adjustmentReasons.map((reason) => <option key={reason.code} value={reason.code}>{reason.name}</option>)}</select></label> : null}
        {kind === "adjustment" ? <p className="text-sm text-muted-foreground">Each CSV row must include a specific 2–500 character note explaining the adjustment.</p> : <Input onChange={(event) => setNote(event.target.value)} placeholder={kind === "count" ? "Optional count note" : "Optional purchase order note"} value={note} />}
        <div className="flex flex-wrap items-end gap-3"><div className="grid min-w-0 flex-1 gap-1 sm:min-w-56"><Label htmlFor="inventory-csv-file">Import file</Label><Input accept=".csv,text/csv" id="inventory-csv-file" onChange={(event) => void chooseFile(event.target.files?.[0])} type="file" /></div><Button onClick={downloadTemplate} type="button" variant="outline"><Download /> Template</Button></div>
        {errors.length ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><p className="font-medium">Fix the CSV before importing.</p><ul className="mt-1 list-disc pl-5">{errors.slice(0, 4).map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
        {rows.length ? <div className="overflow-hidden rounded-lg border"><div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-sm"><span>{filename}: {rows.length} valid row{rows.length === 1 ? "" : "s"}</span><Button disabled={isPending || (kind === "purchase" && !supplierId) || (kind === "adjustment" && !reasonCode)} onClick={confirmImport} size="sm" type="button">{isPending ? <LoaderCircle className="animate-spin" /> : <Upload />} Confirm import</Button></div><div className="max-h-48 overflow-auto"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-background text-muted-foreground"><tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">Item code</th><th className="px-3 py-2">Quantity</th></tr></thead><tbody>{rows.slice(0, 20).map((row) => <tr className="border-t" key={row.rowNumber}><td className="px-3 py-2">{row.rowNumber}</td><td className="px-3 py-2">{row.itemCode}</td><td className="px-3 py-2">{row.quantity}</td></tr>)}</tbody></table></div></div> : null}
        {result ? <p aria-live="polite" className="text-sm text-muted-foreground">{result}</p> : null}
      </CardContent>
    </Card>
    {adjustmentApprovalRequestId ? <ManagerApprovalDialog approvalRequestId={adjustmentApprovalRequestId} onApproved={() => {
      const requestId = adjustmentApprovalRequestId;
      setAdjustmentApprovalRequestId(null);
      startTransition(async () => { await executeAdjustmentImport(requestId); });
    }} onCancel={() => setAdjustmentApprovalRequestId(null)} operationLabel="Inventory adjustment import" /> : null}
  </>;
}

function DraftPurchaseLines({
  lines,
  items,
  currencyCode,
  onChange,
  onAdd,
}: {
  lines: PurchaseDraft[];
  items: AdvancedInventoryItem[];
  currencyCode: string;
  onChange: (lines: PurchaseDraft[]) => void;
  onAdd: () => PurchaseDraft;
}) {
  return (
    <DraftList title="Order items" onAdd={() => onChange([...lines, onAdd()])}>
      {lines.map((line, index) => (
        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(12rem,1fr)_8rem_7rem_8rem_auto] sm:items-end" key={`${index}-${line.productId}-${line.variantId}`}>
          <ItemSelect
            label="Item"
            items={items}
            productId={line.productId}
            variantId={line.variantId}
            onChange={(item) => {
              const selectedItem = items.find((candidate) => candidate.productId === item.productId && (candidate.variantId ?? "") === item.variantId);
              onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, ...item, purchaseUnitCode: selectedItem?.purchaseUnits[0]?.code ?? "" } : current));
            }}
          />
          <Field label="Purchase unit">
            <select
              className={selectClassName}
              value={line.purchaseUnitCode}
              onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, purchaseUnitCode: event.target.value } : current))}
            >
              {(items.find((item) => item.productId === line.productId && (item.variantId ?? "") === line.variantId)?.purchaseUnits ?? []).map((unit) => (
                <option key={unit.code} value={unit.code}>{unit.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Quantity"><Input inputMode="decimal" value={line.quantity} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, quantity: event.target.value } : current))} /></Field>
          <Field label={`Cost / unit (${currencyCode})`}><Input inputMode="decimal" value={line.unitCost} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, unitCost: event.target.value } : current))} /></Field>
          <RemoveLine disabled={lines.length === 1} onRemove={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))} />
        </div>
      ))}
    </DraftList>
  );
}

function CountReviewCard({
  onBack,
  onPost,
  pending,
  review,
}: {
  onBack: () => void;
  onPost: () => void;
  pending: boolean;
  review: CountReview;
}) {
  const varianceCount = review.lines.filter((line) => line.difference !== 0).length;

  return (
    <section aria-labelledby="count-review-title" className="rounded-xl border bg-muted/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium" id="count-review-title">Review count</h3><p className="mt-1 text-sm text-muted-foreground">{review.storeName} · {review.lines.length} item{review.lines.length === 1 ? "" : "s"}</p></div><span className="text-sm text-muted-foreground">{varianceCount} variance{varianceCount === 1 ? "" : "s"}</span></div>
      <div className="mt-4 overflow-x-auto rounded-lg border"><table className="w-full min-w-[34rem] text-left text-sm"><thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr><th className="px-3 py-2 font-medium">Product</th><th className="px-3 py-2 text-right font-medium">Expected</th><th className="px-3 py-2 text-right font-medium">Counted</th><th className="px-3 py-2 text-right font-medium">Difference</th></tr></thead><tbody className="divide-y">{review.lines.map((line) => <tr key={`${line.productId}|${line.variantId}`}><td className="px-3 py-2 font-medium">{line.label}</td><td className="px-3 py-2 text-right">{formatQuantity(line.expectedQuantity)} {line.unit}</td><td className="px-3 py-2 text-right">{formatQuantity(line.countedQuantity)} {line.unit}</td><td className={line.difference === 0 ? "px-3 py-2 text-right" : line.difference > 0 ? "px-3 py-2 text-right font-medium text-primary" : "px-3 py-2 text-right font-medium text-destructive"}>{line.difference > 0 ? "+" : ""}{formatQuantity(line.difference)} {line.unit}</td></tr>)}</tbody></table></div>
      {review.note ? <p className="mt-3 text-sm text-muted-foreground">Notes: {review.note}</p> : null}
      <p className="mt-3 text-xs text-muted-foreground">The expected quantity is a review preview. TINDIO locks and recalculates each authoritative stock level before posting count variances.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><Button disabled={pending} onClick={onBack} type="button" variant="outline">Back</Button><Button disabled={pending} onClick={onPost} type="button">{pending ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />} Post count adjustments</Button></div>
    </section>
  );
}

function PurchasingSectionTabs({
  activeSection,
  onChange,
}: {
  activeSection: "orders" | "receiving" | "suppliers";
  onChange: (section: "orders" | "receiving" | "suppliers") => void;
}) {
  const sections = [
    { id: "orders" as const, label: "Purchase orders" },
    { id: "receiving" as const, label: "Receiving" },
    { id: "suppliers" as const, label: "Suppliers" },
  ];

  return (
    <div aria-label="Purchasing sections" className="flex flex-wrap gap-2" role="tablist">
      {sections.map((section) => (
        <Button
          aria-selected={activeSection === section.id}
          key={section.id}
          onClick={() => onChange(section.id)}
          role="tab"
          size="sm"
          type="button"
          variant={activeSection === section.id ? "secondary" : "outline"}
        >
          {section.label}
        </Button>
      ))}
    </div>
  );
}

function PurchaseOrdersCard({
  canCancel,
  canReceive,
  canViewCosts,
  currencyCode,
  onReceive,
  orders,
}: {
  canCancel: boolean;
  canReceive: boolean;
  canViewCosts: boolean;
  currencyCode: string;
  onReceive: (order: AdvancedPurchaseOrder) => void;
  orders: AdvancedPurchaseOrder[];
}) {
  return (
    <WorkflowCard
      description="Recent purchase orders stay separate from stock while keeping supplier, store, status, and receiving progress clear."
      icon={<Truck aria-hidden="true" />}
      title="Purchase orders"
    >
      {orders.length ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">PO</th>
                <th className="px-3 py-2 font-medium">Supplier</th>
                <th className="px-3 py-2 font-medium">Store</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Expected</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {orders.map((order) => {
                const receivable = order.status === "ordered" || order.status === "partially_received";
                return (
                  <tr key={order.id}>
                    <td className="px-3 py-3 align-top font-medium">
                      <p>PO #{order.orderNumber}</p>
                      <details className="mt-1 text-xs font-normal text-muted-foreground">
                        <summary className="cursor-pointer">{order.lines.length} item{order.lines.length === 1 ? "" : "s"}</summary>
                        <ul className="mt-2 space-y-1">
                          {order.lines.map((line) => <li key={line.id}>{line.label}: {formatQuantity(line.orderedQuantity)} {line.unit} ordered · {formatQuantity(line.receivedQuantity)} received{canViewCosts ? ` · ${formatMoney(line.unitCostMinor, currencyCode)} each` : ""}</li>)}
                        </ul>
                      </details>
                    </td>
                    <td className="px-3 py-3 align-top">{order.supplierName}</td>
                    <td className="px-3 py-3 align-top">{order.storeName}</td>
                    <td className="px-3 py-3 align-top"><PurchaseOrderStatus status={order.status} /></td>
                    <td className="px-3 py-3 align-top text-muted-foreground">{order.expectedAt ? formatPurchaseDate(order.expectedAt) : "Not scheduled"}</td>
                    <td className="px-3 py-3 text-right align-top">{canViewCosts ? formatMoney(order.totalCostMinor, currencyCode) : "Restricted"}</td>
                    <td className="px-3 py-3 text-right align-top">
                      {receivable && (canReceive || canCancel) ? (
                        <div className="flex justify-end gap-2">
                          {canReceive ? <Button onClick={() => onReceive(order)} size="sm" type="button" variant="outline">Receive</Button> : null}
                          {canCancel ? <CancelPurchaseOrderButton order={order} /> : null}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <EmptyWorkflow message="No purchase orders yet. Create an order when stock is expected from a supplier." />
      )}
    </WorkflowCard>
  );
}

function PurchaseOrderStatus({ status }: { status: AdvancedPurchaseOrder["status"] }) {
  const labels: Record<AdvancedPurchaseOrder["status"], string> = {
    cancelled: "Cancelled",
    draft: "Draft",
    ordered: "Ordered",
    partially_received: "Partially received",
    received: "Received",
  };
  const className = status === "received"
    ? "rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary"
    : status === "partially_received"
      ? "rounded-full bg-secondary px-2 py-1 text-xs font-medium"
      : "rounded-full border px-2 py-1 text-xs font-medium";

  return <span className={className}>{labels[status]}</span>;
}

function CancelPurchaseOrderButton({ order }: { order: AdvancedPurchaseOrder }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<WorkflowResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function cancelOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const nextResult = await cancelPurchaseOrderAction({ purchaseOrderId: order.id, note });
      setResult(nextResult);
      if (nextResult.ok) {
        setOpen(false);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (!nextOpen) setResult(null); }}>
      <DialogTrigger className="inline-flex h-8 items-center justify-center rounded-md border border-destructive/30 px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/5">
        Cancel
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel purchase order #{order.orderNumber}?</DialogTitle>
          <DialogDescription>
            This stops future receiving. Goods already received remain in stock and in the inventory ledger.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={cancelOrder}>
          <DialogBody>
            <Field label="Cancellation note">
              <Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional reason for the audit trail" />
            </Field>
            <ResultMessage result={result} />
          </DialogBody>
          <DialogFooter className="border-t px-4 py-4 sm:px-6">
            <Button disabled={isPending} type="submit" variant="destructive">
              {isPending ? <LoaderCircle className="animate-spin" /> : null}
              Cancel purchase order
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog.Root>
  );
}

function RecentReceiptsCard({ receipts }: { receipts: AdvancedGoodsReceipt[] }) {
  return (
    <WorkflowCard
      description="Each receipt remains a historical record linked to its purchase order and stock movements."
      icon={<PackageCheck aria-hidden="true" />}
      title="Receiving history"
    >
      {receipts.length ? (
        <div className="divide-y rounded-lg border">
          {receipts.map((receipt) => (
            <article className="flex flex-wrap items-start justify-between gap-3 px-3 py-3" key={receipt.id}>
              <div>
                <p className="font-medium">GR-{String(receipt.receiptNumber).padStart(6, "0")}</p>
                <p className="mt-1 text-xs text-muted-foreground">Purchase order #{receipt.purchaseOrderNumber}</p>
                <p className="mt-1 text-xs text-muted-foreground">{receipt.storeName} · {formatPurchaseDate(receipt.receivedAt, true)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{receipt.lines.map((line) => `${formatQuantity(line.quantity)} ${line.unit} ${line.label}`).join(" · ")}</p>
                {receipt.note ? <p className="mt-1 text-xs text-muted-foreground">{receipt.note}</p> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyWorkflow message="No receiving records yet. Completed deliveries will remain visible here." />
      )}
    </WorkflowCard>
  );
}

function DraftCountLines({
  lines,
  items,
  storeId,
  onChange,
  onAdd,
}: {
  lines: CountDraft[];
  items: AdvancedInventoryItem[];
  storeId: string;
  onChange: (lines: CountDraft[]) => void;
  onAdd: () => CountDraft;
}) {
  return (
    <DraftList title="Counted items" onAdd={() => onChange([...lines, onAdd()])}>
      {lines.map((line, index) => {
        const item = findItem(items, line);
        return (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" key={`${index}-${line.productId}-${line.variantId}`}>
            <ItemSelect label="Item" items={items} productId={line.productId} variantId={line.variantId} onChange={(next) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, ...next } : current))} />
            <Field label={`Counted (${item?.unit ?? "units"})`}><Input inputMode="decimal" value={line.countedQuantity} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, countedQuantity: event.target.value } : current))} /></Field>
            <RemoveLine disabled={lines.length === 1} onRemove={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))} />
            {item ? <p className="text-xs text-muted-foreground sm:col-span-3">System quantity: {formatQuantity(item.quantitiesByStore[storeId] ?? 0)} {item.unit}</p> : null}
          </div>
        );
      })}
    </DraftList>
  );
}

function DraftTransferLines({
  lines,
  items,
  storeId,
  onChange,
  onAdd,
}: {
  lines: SaleableDraft[];
  items: AdvancedInventoryItem[];
  storeId: string;
  onChange: (lines: SaleableDraft[]) => void;
  onAdd: () => SaleableDraft;
}) {
  return (
    <DraftList title="Transfer items" onAdd={() => onChange([...lines, onAdd()])}>
      {lines.map((line, index) => {
        const item = findItem(items, line);
        return (
          <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end" key={`${index}-${line.productId}-${line.variantId}`}>
            <ItemSelect label="Item" items={items} productId={line.productId} variantId={line.variantId} onChange={(next) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, ...next } : current))} />
            <Field label={`Quantity (${item?.unit ?? "units"})`}><Input inputMode="decimal" value={line.quantity} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, quantity: event.target.value } : current))} /></Field>
            <RemoveLine disabled={lines.length === 1} onRemove={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))} />
            {item ? <p className="text-xs text-muted-foreground sm:col-span-3">Available to transfer: {formatQuantity(item.quantitiesByStore[storeId] ?? 0)} {item.unit}</p> : null}
          </div>
        );
      })}
    </DraftList>
  );
}

function DraftList({ title, children, onAdd }: { title: string; children: ReactNode; onAdd: () => void }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Button size="sm" type="button" variant="outline" onClick={onAdd}><Plus /> Add item</Button>
      </div>
      {children}
    </div>
  );
}

function ItemSelect({
  label,
  items,
  productId,
  variantId,
  onChange,
}: {
  label: string;
  items: AdvancedInventoryItem[];
  productId: string;
  variantId: string;
  onChange: (item: { productId: string; variantId: string }) => void;
}) {
  const value = `${productId}|${variantId}`;
  return (
    <Field label={label}>
      <select className={selectClassName} value={value} onChange={(event) => {
        const [nextProductId, nextVariantId = ""] = event.target.value.split("|");
        onChange({ productId: nextProductId, variantId: nextVariantId });
      }}>
        {items.map((item) => <option key={`${item.productId}|${item.variantId ?? ""}`} value={`${item.productId}|${item.variantId ?? ""}`}>{item.label}</option>)}
      </select>
    </Field>
  );
}

function RemoveLine({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  return <Button aria-label="Remove item" disabled={disabled} size="icon-sm" type="button" variant="ghost" onClick={onRemove}><Trash2 /></Button>;
}

function WorkflowCard({ title, description, icon, children }: { title: string; description: string; icon: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">{icon}</span>
        <div><CardTitle>{title}</CardTitle><CardDescription className="mt-1">{description}</CardDescription></div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function EditSupplierDialog({ supplier }: { supplier: AdvancedInventorySupplier }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<SupplierDraft>({
    name: supplier.name,
    contactName: supplier.contactName ?? "",
    email: supplier.email ?? "",
    phone: supplier.phone ?? "",
    address: supplier.address ?? "",
    notes: supplier.notes ?? "",
  });
  const [isActive, setIsActive] = useState(supplier.isActive);
  const [result, setResult] = useState<WorkflowResult | null>(null);

  function resetDraft() {
    setDraft({
      name: supplier.name,
      contactName: supplier.contactName ?? "",
      email: supplier.email ?? "",
      phone: supplier.phone ?? "",
      address: supplier.address ?? "",
      notes: supplier.notes ?? "",
    });
    setIsActive(supplier.isActive);
    setResult(null);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const nextResult = await updateSupplierAction({ supplierId: supplier.id, ...draft, isActive });
      setResult(nextResult);
      if (nextResult.ok) router.refresh();
    });
  }

  return (
    <Dialog.Root>
      <DialogTrigger render={<Button size="sm" type="button" variant="outline" onClick={resetDraft} />}>
        <Pencil />
        Edit
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit supplier</DialogTitle>
          <DialogDescription>
            Update supplier contact details or safely deactivate it. Existing purchase history is retained.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit} noValidate>
            <Field label="Supplier name">
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="Contact name">
              <Input value={draft.contactName} onChange={(event) => setDraft({ ...draft, contactName: event.target.value })} />
            </Field>
            <Field label="Email">
              <Input inputMode="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} />
            </Field>
            <Field label="Phone">
              <Input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
            </Field>
            <Field className="sm:col-span-2" label="Address">
              <Input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
            </Field>
            <Field className="sm:col-span-2" label="Notes">
              <Input value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium sm:col-span-2">
              <input checked={isActive} type="checkbox" onChange={(event) => setIsActive(event.target.checked)} />
              Active for new purchase orders
            </label>
            <DialogFooter className="sm:col-span-2">
              <ResultMessage result={result} />
              <Button disabled={isPending} type="submit">
                {isPending ? <LoaderCircle className="animate-spin" /> : <Pencil />}
                Save supplier
              </Button>
            </DialogFooter>
          </form>
        </DialogBody>
      </DialogContent>
    </Dialog.Root>
  );
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <div className={`grid gap-1.5 ${className}`}><Label>{label}</Label>{children}</div>;
}

function ResultMessage({ result }: { result: WorkflowResult | null }) {
  if (!result) return <span className="min-h-5 text-xs text-muted-foreground" />;
  return <p className={result.ok ? "text-xs text-primary" : "text-xs text-destructive"} role="status">{result.message}</p>;
}

function EmptyWorkflow({ message }: { message: string }) {
  return <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{message}</p>;
}

function receiptDraft(order: AdvancedPurchaseOrder | undefined) {
  return Object.fromEntries(
    (order?.lines ?? []).map((line) => [line.id, String(line.orderedQuantity - line.receivedQuantity)]),
  );
}

function findItem(items: AdvancedInventoryItem[], line: { productId: string; variantId: string }) {
  return items.find((item) => item.productId === line.productId && (item.variantId ?? "") === line.variantId);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", { maximumFractionDigits: 3 }).format(value);
}

function formatPurchaseDate(value: string, includeTime = false) {
  return new Intl.DateTimeFormat("en-PH", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(new Date(value));
}

function formatMoney(valueMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: currencyCode }).format(valueMinor / 100);
}
