"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, Download, LoaderCircle, PackagePlus, Plus, Printer, Search, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { BackOfficeDetailDrawer } from "@/components/back-office/back-office-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  cancelInventoryCountAction,
  createInventoryCountDraftAction,
  postInventoryCountAction,
  saveInventoryCountLineAction,
  submitInventoryCountForReviewAction,
} from "@/features/inventory/advanced-inventory-actions";

type Store = { id: string; name: string };
type Category = { id: string; name: string };
type Supplier = { id: string; name: string };
type Item = {
  productId: string;
  variantId: string | null;
  label: string;
  unit: string;
  categoryId: string | null;
  categoryName: string;
  sku: string | null;
  barcode: string | null;
  storeIds: string[];
  quantitiesByStore: Record<string, number>;
};
type CountMode = "standard" | "blind";
type ScopeType = "full_store" | "category" | "supplier" | "selected";
type SortMode = "category_name" | "supplier_name" | "sku" | "barcode" | "product_name";
type CountStatus = "draft" | "in_progress" | "ready_for_review" | "posted" | "cancelled" | "open" | "completed";
type CountLine = {
  id: string;
  productId: string;
  variantId: string | null;
  label: string;
  categoryName: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  expectedQuantity: number;
  reconciledExpectedQuantity: number | null;
  countedQuantity: number | null;
  countedAt: string | null;
};
type CountDocument = {
  id: string;
  countNumber: number;
  countMode: CountMode;
  scopeType: ScopeType;
  scopeReferenceId: string | null;
  sortMode: SortMode;
  includeZeroStock: boolean;
  storeName: string;
  status: CountStatus;
  note: string | null;
  updatedAt: string;
  lines: CountLine[];
};

const selectClassName = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function InventoryCountWorkspace({ categories, documents, items, stores, suppliers }: {
  categories: Category[];
  documents: CountDocument[];
  items: Item[];
  stores: Store[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [pendingAction, setPendingAction] = useState<"create" | "line" | "review" | "post" | "cancel" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedDocument = useMemo(() => documents.find((document) => document.id === selectedCountId) ?? null, [documents, selectedCountId]);
  const drawerOpen = isCreating || Boolean(selectedDocument);

  const run = async (action: NonNullable<typeof pendingAction>, work: () => Promise<{ ok: boolean; message: string; data?: { inventoryCountId: string } }>) => {
    setPendingAction(action);
    setMessage(null);
    try {
      const result = await work();
      setMessage(result.message);
      if (result.ok) {
        if (result.data?.inventoryCountId) {
          setSelectedCountId(result.data.inventoryCountId);
          setIsCreating(false);
        }
        router.refresh();
      }
      return result.ok;
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <>
      <section aria-labelledby="inventory-counts-title" className="space-y-4" data-inventory-count-screen>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold" id="inventory-counts-title">Inventory counts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Prepare one ordered count sheet per store, save it as you work, then review and post its traceable variance.</p>
          </div>
          <Button onClick={() => { setMessage(null); setIsCreating(true); }} type="button"><Plus />New inventory count</Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Count documents</CardTitle>
            <CardDescription>Drafts change no stock. Posted documents remain available as historical records.</CardDescription>
          </CardHeader>
          <CardContent>
            {documents.length ? <CountDocumentList documents={documents} onSelect={setSelectedCountId} /> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No count documents are in this store scope yet.</p>}
          </CardContent>
        </Card>

        <Dialog.Root open={drawerOpen} onOpenChange={(open) => { if (!open) { setIsCreating(false); setSelectedCountId(null); setMessage(null); } }}>
          <BackOfficeDetailDrawer closeLabel={isCreating ? "Close new inventory count" : "Close inventory count"} width="wide">
            {isCreating ? (
              <CreateCountDrawer
                categories={categories}
                items={items}
                message={message}
                pending={pendingAction === "create"}
                stores={stores}
                suppliers={suppliers}
                onSubmit={(input) => void run("create", () => createInventoryCountDraftAction(input))}
              />
            ) : selectedDocument ? (
              <CountDetailDrawer
                document={selectedDocument}
                items={items}
                message={message}
                pendingAction={pendingAction}
                onCancel={() => void run("cancel", () => cancelInventoryCountAction({ inventoryCountId: selectedDocument.id, note: "Cancelled from Inventory Control" }))}
                onPost={() => void run("post", () => postInventoryCountAction({ inventoryCountId: selectedDocument.id }))}
                onSaveLine={(line, quantity) => run("line", () => saveInventoryCountLineAction({
                  inventoryCountId: selectedDocument.id,
                  productId: line.productId,
                  variantId: line.variantId ?? "",
                  countedQuantity: quantity,
                }))}
                onSubmitForReview={() => void run("review", () => submitInventoryCountForReviewAction({ inventoryCountId: selectedDocument.id }))}
              />
            ) : null}
          </BackOfficeDetailDrawer>
        </Dialog.Root>
      </section>
      {selectedDocument ? <CountPrintDocument document={selectedDocument} /> : null}
    </>
  );
}

function CountDocumentList({ documents, onSelect }: { documents: CountDocument[]; onSelect: (id: string) => void }) {
  return <div className="overflow-hidden rounded-xl border">
    <div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(8rem,.75fr)_7rem_7rem_8rem] gap-4 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground md:grid">
      <span>Count</span><span>Store</span><span>Progress</span><span>Mode</span><span>Status</span>
    </div>
    <div className="divide-y">{documents.map((document) => {
      const saved = document.lines.filter((line) => line.countedQuantity !== null).length;
      return <button aria-label={`View inventory count ${formatReference(document.countNumber)}`} className="grid w-full gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(8rem,1fr)_minmax(8rem,.75fr)_7rem_7rem_8rem] md:items-center md:gap-4" key={document.id} onClick={() => onSelect(document.id)} type="button">
        <span><span className="font-medium text-primary">{formatReference(document.countNumber)}</span><span className="mt-1 block text-xs text-muted-foreground">{document.note || formatDate(document.updatedAt)}</span></span>
        <span className="text-sm text-muted-foreground">{document.storeName}</span>
        <span className="text-sm text-muted-foreground">{saved}/{document.lines.length}</span>
        <span className="text-sm capitalize text-muted-foreground">{document.countMode}</span>
        <span><Badge variant={statusVariant(document.status)}>{formatStatus(document.status)}</Badge></span>
      </button>;
    })}</div>
  </div>;
}

function CreateCountDrawer({ categories, items, message, onSubmit, pending, stores, suppliers }: {
  categories: Category[];
  items: Item[];
  message: string | null;
  onSubmit: (input: unknown) => void;
  pending: boolean;
  stores: Store[];
  suppliers: Supplier[];
}) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [countMode, setCountMode] = useState<CountMode>("standard");
  const [scopeType, setScopeType] = useState<ScopeType>("full_store");
  const [scopeReferenceId, setScopeReferenceId] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("category_name");
  const [includeZeroStock, setIncludeZeroStock] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const availableItems = useMemo(() => items.filter((item) => item.storeIds.includes(storeId)), [items, storeId]);
  const visibleItems = availableItems.filter((item) => `${item.label} ${item.sku ?? ""} ${item.barcode ?? ""}`.toLowerCase().includes(search.toLowerCase())).slice(0, 100);

  const submit = () => onSubmit({
    storeId,
    note,
    countMode,
    scopeType,
    scopeReferenceId,
    selectedItems: selectedKeys.map((key) => {
      const [productId, variantId] = key.split("|");
      return { productId, variantId };
    }),
    sortMode,
    includeZeroStock,
  });

  return <>
    <DialogHeader><DialogTitle>New inventory count</DialogTitle><DialogDescription>Choose the store and scope once. TINDIO will create a stable, resumable count sheet without changing stock.</DialogDescription></DialogHeader>
    <DialogBody className="flex-1 max-h-none space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Store"><select className={selectClassName} value={storeId} onChange={(event) => { setStoreId(event.target.value); setSelectedKeys([]); }}><option value="">Select store</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></Field>
        <Field label="Count mode"><select className={selectClassName} value={countMode} onChange={(event) => setCountMode(event.target.value as CountMode)}><option value="standard">Standard — show expected quantity</option><option value="blind">Blind — hide expected quantity</option></select></Field>
        <Field label="Count scope"><select className={selectClassName} value={scopeType} onChange={(event) => { setScopeType(event.target.value as ScopeType); setScopeReferenceId(""); }}><option value="full_store">Full store</option><option value="category">Category</option><option value="supplier">Supplier</option><option value="selected">Selected products</option></select></Field>
        <Field label="Sort count sheet"><select className={selectClassName} value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="category_name">Category → product → variant</option><option value="product_name">Product name</option><option value="supplier_name">Supplier</option><option value="sku">SKU</option><option value="barcode">Barcode</option></select></Field>
      </div>

      {scopeType === "category" ? <Field label="Category"><select className={selectClassName} value={scopeReferenceId} onChange={(event) => setScopeReferenceId(event.target.value)}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Field> : null}
      {scopeType === "supplier" ? <Field label="Supplier"><select className={selectClassName} value={scopeReferenceId} onChange={(event) => setScopeReferenceId(event.target.value)}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select><span className="text-xs font-normal text-muted-foreground">Supplier scope uses the store&apos;s existing purchase-order history.</span></Field> : null}
      {scopeType === "selected" ? <section className="space-y-3 rounded-xl border p-4">
        <div><h3 className="font-medium">Choose products</h3><p className="mt-1 text-sm text-muted-foreground">Only active, inventory-tracked items available at this store are listed.</p></div>
        <label className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU, or barcode" /></label>
        <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">{visibleItems.map((item) => {
          const key = itemKey(item);
          return <label className="flex min-h-11 items-start gap-3 px-3 py-2.5 text-sm hover:bg-muted/50" key={key}><input checked={selectedKeys.includes(key)} className="mt-0.5 size-4" onChange={(event) => setSelectedKeys((current) => event.target.checked ? [...current, key] : current.filter((value) => value !== key))} type="checkbox" /><span><span className="font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.categoryName}{item.sku ? ` · ${item.sku}` : ""}</span></span></label>;
        })}{visibleItems.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No matching products are available in this store.</p> : null}</div>
        <p className="text-xs text-muted-foreground">{selectedKeys.length} selected</p>
      </section> : null}

      <label className="flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm"><input checked={includeZeroStock} className="mt-0.5 size-4" onChange={(event) => setIncludeZeroStock(event.target.checked)} type="checkbox" /><span><span className="font-medium">Include zero-stock items</span><span className="mt-0.5 block text-xs text-muted-foreground">Recommended for full counts so physically found stock is not missed.</span></span></label>
      <Field label="Count note (optional)"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. September full stocktake" /></Field>
      <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">The screen, printed sheet, and CSV use the prepared document&apos;s same saved order. Blind counts omit expected quantities from both print and export.</p>
      <ResultMessage result={message} />
    </DialogBody>
    <DialogFooter className="border-t px-4 py-4 sm:px-6"><Button disabled={pending || !storeId} onClick={submit} type="button">{pending ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}{pending ? "Preparing count…" : "Prepare count"}</Button></DialogFooter>
  </>;
}

function CountDetailDrawer({ document, items, message, onCancel, onPost, onSaveLine, onSubmitForReview, pendingAction }: {
  document: CountDocument;
  items: Item[];
  message: string | null;
  onCancel: () => void;
  onPost: () => void;
  onSaveLine: (line: Pick<CountLine, "productId" | "variantId">, quantity: string) => Promise<boolean>;
  onSubmitForReview: () => void;
  pendingAction: "create" | "line" | "review" | "post" | "cancel" | null;
}) {
  const editable = document.status === "draft" || document.status === "in_progress";
  const uncounted = document.lines.filter((line) => line.countedQuantity === null);
  const [productKey, setProductKey] = useState(() => uncounted[0] ? itemKey(uncounted[0]) : document.lines[0] ? itemKey(document.lines[0]) : "");
  const [quantity, setQuantity] = useState("");
  const selectedLine = document.lines.find((line) => itemKey(line) === productKey) ?? null;
  const selectedItem = selectedLine ?? items.find((item) => itemKey(item) === productKey) ?? null;
  const unexpectedItems = items.filter((item) => !document.lines.some((line) => itemKey(line) === itemKey(item)));
  const matched = document.lines.filter((line) => line.countedQuantity !== null && line.countedQuantity === reconciliationExpected(line)).length;
  const short = document.lines.filter((line) => line.countedQuantity !== null && line.countedQuantity < reconciliationExpected(line)).length;
  const over = document.lines.filter((line) => line.countedQuantity !== null && line.countedQuantity > reconciliationExpected(line)).length;

  const saveLine = async () => {
    if (!selectedItem || quantity === "") return;
    const ok = await onSaveLine(selectedItem, quantity);
    if (ok) setQuantity("");
  };

  const print = () => {
    const cleanup = () => documentBodyCleanup();
    window.document.body.dataset.printMode = "inventory-count";
    window.addEventListener("afterprint", cleanup, { once: true });
    window.print();
    window.setTimeout(cleanup, 1000);
  };

  return <>
    <DialogHeader><div className="flex items-start justify-between gap-3"><div><DialogTitle>{formatReference(document.countNumber)}</DialogTitle><DialogDescription>{document.storeName} · {formatScope(document.scopeType)} · updated {formatDate(document.updatedAt)}</DialogDescription></div><Badge variant={statusVariant(document.status)}>{formatStatus(document.status)}</Badge></div></DialogHeader>
    <DialogBody className="flex-1 max-h-none space-y-5">
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{document.countMode === "blind" ? "Blind count" : "Standard count"}</Badge><Badge variant="outline">{formatSort(document.sortMode)}</Badge><Badge variant="outline">{document.includeZeroStock ? "Includes zero stock" : "Non-zero stock"}</Badge></div>
      {document.note ? <section><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</p><p className="mt-1 text-sm">{document.note}</p></section> : null}
      <div className="grid gap-3 sm:grid-cols-3"><Metric label="Counted" value={`${document.lines.length - uncounted.length}/${document.lines.length}`} />{document.countMode === "standard" ? <><Metric label="Matched" value={String(matched)} /><Metric label="Short / over" value={`${short} / ${over}`} /></> : <Metric label="Mode" value="Expected hidden" />}</div>

      {editable ? <form className="space-y-3 rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); void saveLine(); }}>
        <div><h3 className="font-medium">Record physical quantity</h3><p className="mt-1 text-sm text-muted-foreground">Progress is saved to this count document. Stock changes only after review and posting.</p></div>
        <Field label="Prepared item"><select className={selectClassName} value={productKey} onChange={(event) => { setProductKey(event.target.value); setQuantity(""); }}><optgroup label="Prepared count sheet">{document.lines.map((line) => <option key={itemKey(line)} value={itemKey(line)}>{line.countedQuantity === null ? "○" : "✓"} {line.label}</option>)}</optgroup>{unexpectedItems.length ? <optgroup label="Unexpected item found">{unexpectedItems.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.label}</option>)}</optgroup> : null}</select></Field>
        <Field label="Physical quantity"><Input inputMode="decimal" min="0" onChange={(event) => setQuantity(event.target.value)} placeholder={selectedLine?.countedQuantity === null ? "0" : String(selectedLine?.countedQuantity ?? 0)} step="0.001" type="number" value={quantity} /></Field>
        <Button disabled={pendingAction === "line" || !selectedItem || quantity === ""} type="submit">{pendingAction === "line" ? <LoaderCircle className="animate-spin" /> : <PackagePlus />}{pendingAction === "line" ? "Saving item…" : "Save item"}</Button>
      </form> : null}

      <section aria-labelledby="count-sheet-title">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-medium" id="count-sheet-title">Count sheet</h3><p className="mt-1 text-sm text-muted-foreground">Prepared items remain in their saved order. {document.countMode === "blind" ? "Expected quantities stay hidden." : "The snapshot remains historical; reconciliation reflects authoritative stock when each physical quantity was saved."}</p></div><div className="flex gap-2"><Button onClick={print} size="sm" type="button" variant="outline"><Printer />Print</Button><Button onClick={() => downloadCountCsv(document)} size="sm" type="button" variant="outline"><Download />CSV</Button></div></div>
        <div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full min-w-[42rem] text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">SKU / barcode</th>{document.countMode === "standard" ? <><th className="px-3 py-2 text-right">Snapshot</th><th className="px-3 py-2 text-right">Reconciled</th></> : null}<th className="px-3 py-2 text-right">Counted</th>{document.countMode === "standard" ? <th className="px-3 py-2 text-right">Variance</th> : null}</tr></thead><tbody className="divide-y">{document.lines.map((line) => {
          const variance = line.countedQuantity === null || line.reconciledExpectedQuantity === null ? null : line.countedQuantity - line.reconciledExpectedQuantity;
          return <tr key={line.id}><td className="px-3 py-2"><span className="font-medium">{line.label}</span><span className="block text-xs text-muted-foreground">{line.categoryName}</span></td><td className="px-3 py-2 text-muted-foreground">{line.sku || line.barcode || "—"}</td>{document.countMode === "standard" ? <><td className="px-3 py-2 text-right">{formatQuantity(line.expectedQuantity)}</td><td className="px-3 py-2 text-right">{line.reconciledExpectedQuantity === null ? <span className="text-muted-foreground">Not reconciled</span> : formatQuantity(line.reconciledExpectedQuantity)}</td></> : null}<td className="px-3 py-2 text-right">{line.countedQuantity === null ? <span className="text-muted-foreground">Not counted</span> : formatQuantity(line.countedQuantity)}</td>{document.countMode === "standard" ? <td className="px-3 py-2 text-right">{variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatQuantity(variance)}`}</td> : null}</tr>;
        })}</tbody></table></div>
      </section>
      <ResultMessage result={message} />
    </DialogBody>
    <DialogFooter className="justify-end border-t px-4 py-4 sm:px-6">
      {(editable || document.status === "ready_for_review") ? <Button disabled={pendingAction === "cancel"} onClick={onCancel} type="button" variant="outline">{pendingAction === "cancel" ? <LoaderCircle className="animate-spin" /> : <XCircle />}{pendingAction === "cancel" ? "Cancelling…" : "Cancel count"}</Button> : null}
      {editable ? <Button disabled={pendingAction === "review" || uncounted.length > 0} onClick={onSubmitForReview} type="button">{pendingAction === "review" ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}{uncounted.length ? `${uncounted.length} left to count` : pendingAction === "review" ? "Submitting…" : "Submit for review"}</Button> : null}
      {document.status === "ready_for_review" ? <Button disabled={pendingAction === "post"} onClick={onPost} type="button">{pendingAction === "post" ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}{pendingAction === "post" ? "Posting…" : "Post reviewed variance"}</Button> : null}
    </DialogFooter>
  </>;
}

function CountPrintDocument({ document }: { document: CountDocument }) {
  return <article className="hidden" data-inventory-count-print-document>
    <header data-inventory-print-header><p>TINDIO INVENTORY COUNT</p><h1>{formatReference(document.countNumber)}</h1><dl><div><dt>Store</dt><dd>{document.storeName}</dd></div><div><dt>Mode</dt><dd className="capitalize">{document.countMode}</dd></div><div><dt>Scope</dt><dd>{formatScope(document.scopeType)}</dd></div><div><dt>Prepared order</dt><dd>{formatSort(document.sortMode)}</dd></div></dl></header>
    <table data-inventory-print-table><thead><tr><th>Item</th><th>Category</th><th>SKU / barcode</th>{document.countMode === "standard" ? <><th>Snapshot</th><th>Reconciled</th></> : null}<th>Counted</th>{document.countMode === "standard" ? <th>Variance</th> : null}</tr></thead><tbody>{document.lines.map((line) => { const variance = line.countedQuantity === null || line.reconciledExpectedQuantity === null ? null : line.countedQuantity - line.reconciledExpectedQuantity; return <tr key={line.id}><td>{line.label}<br /><span>{line.unit}</span></td><td>{line.categoryName}</td><td>{line.sku || line.barcode || "—"}</td>{document.countMode === "standard" ? <><td>{formatQuantity(line.expectedQuantity)}</td><td>{line.reconciledExpectedQuantity === null ? "—" : formatQuantity(line.reconciledExpectedQuantity)}</td></> : null}<td>{line.countedQuantity === null ? "________________" : formatQuantity(line.countedQuantity)}</td>{document.countMode === "standard" ? <td>{variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatQuantity(variance)}`}</td> : null}</tr>; })}</tbody></table>
  </article>;
}

function downloadCountCsv(document: CountDocument) {
  const headers = document.countMode === "blind" ? ["Item", "Category", "SKU", "Barcode", "Unit", "Counted"] : ["Item", "Category", "SKU", "Barcode", "Unit", "Snapshot expected", "Reconciled expected", "Counted", "Variance"];
  const rows = document.lines.map((line) => {
    const base: Array<string | number> = [line.label, line.categoryName, line.sku ?? "", line.barcode ?? "", line.unit];
    if (document.countMode === "blind") return [...base, line.countedQuantity ?? ""];
    return [...base, line.expectedQuantity, line.reconciledExpectedQuantity ?? "", line.countedQuantity ?? "", line.countedQuantity === null || line.reconciledExpectedQuantity === null ? "" : line.countedQuantity - line.reconciledExpectedQuantity];
  });
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${formatReference(document.countNumber)}-${document.storeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function documentBodyCleanup() { window.document.body.removeAttribute("data-print-mode"); }
function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }
function itemKey(item: Pick<Item, "productId" | "variantId"> | Pick<CountLine, "productId" | "variantId">) { return `${item.productId}|${item.variantId ?? ""}`; }
function reconciliationExpected(line: CountLine) { return line.reconciledExpectedQuantity ?? line.expectedQuantity; }
function Field({ children, label }: { children: ReactNode; label: string }) { return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
function ResultMessage({ result }: { result: string | null }) { return result ? <p aria-live="polite" className="text-sm text-muted-foreground">{result}</p> : null; }
function formatReference(countNumber: number) { return `IC-${String(countNumber).padStart(6, "0")}`; }
function formatQuantity(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatStatus(status: CountStatus) { return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatScope(scope: ScopeType) { return ({ full_store: "Full store", category: "Category", supplier: "Supplier", selected: "Selected products" } as const)[scope]; }
function formatSort(sort: SortMode) { return ({ category_name: "Category → product → variant", supplier_name: "Supplier", sku: "SKU", barcode: "Barcode", product_name: "Product name" } as const)[sort]; }
function statusVariant(status: CountStatus) { return status === "posted" || status === "completed" ? "secondary" : status === "cancelled" ? "outline" : "default"; }
