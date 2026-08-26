"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import {
  ClipboardCheck,
  LoaderCircle,
  PackageCheck,
  Pencil,
  Plus,
  SendHorizontal,
  Trash2,
  Truck,
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
import {
  completeInventoryCountAction,
  createPurchaseOrderAction,
  createSupplierAction,
  receivePurchaseOrderAction,
  transferStockAction,
  updateSupplierAction,
} from "@/features/inventory/advanced-inventory-actions";

const selectClassName =
  "h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export type AdvancedInventoryItem = {
  productId: string;
  variantId: string | null;
  label: string;
  unit: string;
  storeIds: string[];
  quantitiesByStore: Record<string, number>;
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
  status: "ordered" | "partially_received";
  supplierName: string;
  storeName: string;
  expectedAt: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    label: string;
    unit: string;
    orderedQuantity: number;
    receivedQuantity: number;
    unitCostMinor: number;
  }>;
};

type StoreOption = { id: string; name: string };
type SaleableDraft = { productId: string; variantId: string; quantity: string };
type PurchaseDraft = SaleableDraft & { unitCost: string };
type CountDraft = { productId: string; variantId: string; countedQuantity: string };
type SupplierDraft = {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
};
type WorkflowResult = { ok: boolean; message: string };

export function AdvancedInventoryWorkflows({
  stores,
  items,
  suppliers,
  purchaseOrders,
  currencyCode,
}: {
  stores: StoreOption[];
  items: AdvancedInventoryItem[];
  suppliers: AdvancedInventorySupplier[];
  purchaseOrders: AdvancedPurchaseOrder[];
  currencyCode: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
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
  const [countResult, setCountResult] = useState<WorkflowResult | null>(null);
  const [transferResult, setTransferResult] = useState<WorkflowResult | null>(null);

  const firstStoreId = stores[0]?.id ?? "";
  const firstItem = items[0];
  const emptyPurchaseLine = (): PurchaseDraft => ({
    productId: firstItem?.productId ?? "",
    variantId: firstItem?.variantId ?? "",
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
  const [receiptOrderId, setReceiptOrderId] = useState(purchaseOrders[0]?.id ?? "");
  const [receiptNote, setReceiptNote] = useState("");
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>(() =>
    receiptDraft(purchaseOrders[0]),
  );
  const [countStoreId, setCountStoreId] = useState(firstStoreId);
  const [countNote, setCountNote] = useState("");
  const [countLines, setCountLines] = useState<CountDraft[]>([emptyCountLine()]);
  const [sourceStoreId, setSourceStoreId] = useState(firstStoreId);
  const [destinationStoreId, setDestinationStoreId] = useState(stores[1]?.id ?? "");
  const [transferNote, setTransferNote] = useState("");
  const [transferLines, setTransferLines] = useState<SaleableDraft[]>([emptyTransferLine()]);

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
  const selectedReceiptOrder = purchaseOrders.find((order) => order.id === receiptOrderId);

  function finish(result: WorkflowResult, setResult: (value: WorkflowResult) => void) {
    setResult(result);
    if (result.ok) router.refresh();
  }

  function submitSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSupplierResult(null);
    startTransition(async () => {
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
    startTransition(async () => {
      const result = await createPurchaseOrderAction({
        storeId: purchaseStoreId,
        supplierId: purchaseSupplierId,
        expectedAt: purchaseExpectedAt,
        notes: purchaseNotes,
        lines: purchaseLines,
      });
      finish(result, setPurchaseResult);
      if (result.ok) {
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
    startTransition(async () => {
      const result = await receivePurchaseOrderAction({
        purchaseOrderId: selectedReceiptOrder.id,
        note: receiptNote,
        lines: selectedReceiptOrder.lines
          .map((line) => ({ purchaseOrderLineId: line.id, quantity: receiptQuantities[line.id] ?? "" }))
          .filter((line) => Number(line.quantity) > 0),
      });
      finish(result, setReceiptResult);
      if (result.ok) setReceiptNote("");
    });
  }

  function submitCount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCountResult(null);
    startTransition(async () => {
      const result = await completeInventoryCountAction({
        storeId: countStoreId,
        note: countNote,
        lines: countLines,
      });
      finish(result, setCountResult);
      if (result.ok) {
        setCountNote("");
        setCountLines([emptyCountLine()]);
      }
    });
  }

  function submitTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTransferResult(null);
    startTransition(async () => {
      const result = await transferStockAction({
        sourceStoreId,
        destinationStoreId,
        note: transferNote,
        lines: transferLines,
      });
      finish(result, setTransferResult);
      if (result.ok) {
        setTransferNote("");
        setTransferLines([emptyTransferLine()]);
      }
    });
  }

  return (
    <section className="space-y-4" aria-labelledby="advanced-inventory-title">
      <div>
        <h2 className="text-lg font-semibold" id="advanced-inventory-title">
          Advanced inventory
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Order from suppliers, receive goods, reconcile stock, and transfer items between stores.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <WorkflowCard
          title="Supplier management"
          description="Keep procurement contacts available for every purchase order."
          icon={<UserPlus aria-hidden="true" />}
        >
          <Dialog.Root>
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
              <Button disabled={isPending} type="submit">
                {isPending ? <LoaderCircle className="animate-spin" /> : <UserPlus />}
                Save supplier
              </Button>
            </DialogFooter>
          </form>
              </DialogBody>
            </DialogContent>
          </Dialog.Root>
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
                    <EditSupplierDialog supplier={supplierOption} />
                    {!supplierOption.isActive ? (
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

        <WorkflowCard
          title="Create purchase order"
          description="Commit expected items and unit cost before goods arrive."
          icon={<Truck aria-hidden="true" />}
        >
          {activeSuppliers.length > 0 && stores.length > 0 && items.length > 0 ? (
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
                <Button disabled={isPending || purchasableItems.length === 0} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <Truck />}
                  Create order
                </Button>
              </div>
            </form>
          ) : (
            <EmptyWorkflow message="Add an active supplier, store, and tracked item before creating a purchase order." />
          )}
        </WorkflowCard>

        <WorkflowCard
          title="Receive purchase order"
          description="Received quantities post receipt movements and update stock immediately."
          icon={<PackageCheck aria-hidden="true" />}
        >
          {purchaseOrders.length > 0 ? (
            <form className="space-y-3" onSubmit={submitReceipt} noValidate>
              <Field label="Open purchase order">
                <select
                  className={selectClassName}
                  value={receiptOrderId}
                  onChange={(event) => chooseReceiptOrder(event.target.value)}
                >
                  {purchaseOrders.map((order) => (
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
                        {formatQuantity(remaining)} {line.unit} remaining · {formatMoney(line.unitCostMinor, currencyCode)} each
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
                <Button disabled={isPending} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <PackageCheck />}
                  Receive goods
                </Button>
              </div>
            </form>
          ) : (
            <EmptyWorkflow message="Open purchase orders will be available here for partial or complete receiving." />
          )}
        </WorkflowCard>

        <WorkflowCard
          title="Complete inventory count"
          description="Enter the physical quantity; a count movement posts only the variance."
          icon={<ClipboardCheck aria-hidden="true" />}
        >
          {stores.length > 0 && items.length > 0 ? (
            <form className="space-y-3" onSubmit={submitCount} noValidate>
              <Field label="Store">
                <select className={selectClassName} value={countStoreId} onChange={(event) => setCountStoreId(event.target.value)}>
                  {stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
                </select>
              </Field>
              <DraftCountLines
                lines={countLines}
                items={countableItems}
                storeId={countStoreId}
                onChange={setCountLines}
                onAdd={emptyCountLine}
              />
              <Field label="Count note">
                <Input value={countNote} onChange={(event) => setCountNote(event.target.value)} placeholder="Optional count reason" />
              </Field>
              <div className="flex items-center justify-between gap-3">
                <ResultMessage result={countResult} />
                <Button disabled={isPending || countableItems.length === 0} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}
                  Complete count
                </Button>
              </div>
            </form>
          ) : (
            <EmptyWorkflow message="Create a tracked item in a store before counting inventory." />
          )}
        </WorkflowCard>

        <WorkflowCard
          title="Transfer stock"
          description="TINDIO records an equal transfer-out and transfer-in, preserving stock accountability."
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
                <Button disabled={isPending || transferableItems.length === 0} type="submit">
                  {isPending ? <LoaderCircle className="animate-spin" /> : <SendHorizontal />}
                  Transfer stock
                </Button>
              </div>
            </form>
          ) : (
            <EmptyWorkflow message="At least two stores and one tracked item are required for stock transfers." />
          )}
        </WorkflowCard>
      </div>
    </section>
  );
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
        <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_7rem_7rem_auto] sm:items-end" key={`${index}-${line.productId}-${line.variantId}`}>
          <ItemSelect
            label="Item"
            items={items}
            productId={line.productId}
            variantId={line.variantId}
            onChange={(item) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, ...item } : current))}
          />
          <Field label="Quantity"><Input inputMode="decimal" value={line.quantity} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, quantity: event.target.value } : current))} /></Field>
          <Field label={`Unit cost (${currencyCode})`}><Input inputMode="decimal" value={line.unitCost} onChange={(event) => onChange(lines.map((current, lineIndex) => lineIndex === index ? { ...current, unitCost: event.target.value } : current))} /></Field>
          <RemoveLine disabled={lines.length === 1} onRemove={() => onChange(lines.filter((_, lineIndex) => lineIndex !== index))} />
        </div>
      ))}
    </DraftList>
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

function formatMoney(valueMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: currencyCode }).format(valueMinor / 100);
}
