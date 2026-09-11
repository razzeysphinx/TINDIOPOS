"use client";

import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { ClipboardCheck, FileSpreadsheet, FileUp, Layers3, LoaderCircle, PackagePlus, Plus, Printer, Search, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

import { BackOfficeDetailDrawer } from "@/components/back-office/back-office-detail-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  cancelInventoryCountAction,
  createInventoryCountBatchAction,
  createInventoryCountDraftAction,
  importInventoryCountLinesAction,
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
  preparedBy: string;
  startedAt: string;
  storeId: string;
  storeName: string;
  status: CountStatus;
  note: string | null;
  updatedAt: string;
  lines: CountLine[];
};
type CountBatch = {
  id: string;
  batchNumber: number;
  createdAt: string;
  updatedAt: string;
  name: string;
  note: string | null;
  documents: CountDocument[];
};
type PendingAction = "create" | "batch" | "line" | "import" | "review" | "post" | "cancel" | null;
type CountActionResult = { ok: boolean; message: string; data?: { importedCount?: number; inventoryCountId?: string; inventoryCountBatchId?: string } };
type ImportRow = { countLineId: string; productId: string; variantId: string; countedQuantity: number };
type ImportPreview = {
  detected: number;
  duplicate: number;
  invalid: number;
  missing: number;
  message: string | null;
  rows: ImportRow[];
  unknown: number;
};

const selectClassName = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";
const quantityPattern = /^\d{1,8}(?:\.\d{1,3})?$/;

export function InventoryCountWorkspace({
  batches,
  canCreateCounts,
  canFinalizeCounts,
  categories,
  documents,
  items,
  stores,
  suppliers,
}: {
  batches: CountBatch[];
  canCreateCounts: boolean;
  canFinalizeCounts: boolean;
  categories: Category[];
  documents: CountDocument[];
  items: Item[];
  stores: Store[];
  suppliers: Supplier[];
}) {
  const router = useRouter();
  const [selectedCountId, setSelectedCountId] = useState<string | null>(null);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [message, setMessage] = useState<string | null>(null);
  const selectedDocument = useMemo(() => documents.find((document) => document.id === selectedCountId) ?? null, [documents, selectedCountId]);
  const selectedBatch = useMemo(() => batches.find((batch) => batch.id === selectedBatchId) ?? null, [batches, selectedBatchId]);
  const drawerOpen = isCreating || isCreatingBatch || Boolean(selectedDocument) || Boolean(selectedBatch);

  const resetDrawer = () => {
    setIsCreating(false);
    setIsCreatingBatch(false);
    setSelectedBatchId(null);
    setSelectedCountId(null);
    setMessage(null);
  };
  const run = async (action: Exclude<PendingAction, null>, work: () => Promise<CountActionResult>) => {
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
        if (result.data?.inventoryCountBatchId) {
          setSelectedBatchId(result.data.inventoryCountBatchId);
          setIsCreatingBatch(false);
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
          {canCreateCounts ? <div className="flex flex-wrap gap-2">
            {stores.length > 1 ? <Button onClick={() => { setMessage(null); setIsCreatingBatch(true); }} type="button" variant="outline"><Layers3 />New count batch</Button> : null}
            <Button onClick={() => { setMessage(null); setIsCreating(true); }} type="button"><Plus />New inventory count</Button>
          </div> : null}
        </div>

        {batches.length || (canCreateCounts && stores.length > 1) ? <Card>
          <CardHeader>
            <CardTitle>Multi-store count batches</CardTitle>
            <CardDescription>A batch coordinates independent store count documents. Each store still reconciles and posts its own stock variance.</CardDescription>
          </CardHeader>
          <CardContent>{batches.length ? <CountBatchList batches={batches} onSelect={setSelectedBatchId} /> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No multi-store count batches are in this store scope yet.</p>}</CardContent>
        </Card> : null}

        <Card>
          <CardHeader>
            <CardTitle>Count documents</CardTitle>
            <CardDescription>Drafts change no stock. Posted documents remain available as historical records.</CardDescription>
          </CardHeader>
          <CardContent>
            {documents.length ? <CountDocumentList documents={documents} onSelect={setSelectedCountId} /> : <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">No count documents are in this store scope yet.</p>}
          </CardContent>
        </Card>

        {!canCreateCounts && !canFinalizeCounts ? <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">You can view only the count documents available in your store scope.</p> : null}

        <Dialog.Root open={drawerOpen} onOpenChange={(open) => { if (!open) resetDrawer(); }}>
          <BackOfficeDetailDrawer closeLabel={isCreating ? "Close new inventory count" : isCreatingBatch ? "Close new count batch" : selectedBatch ? "Close count batch" : "Close inventory count"} width="wide">
            {isCreating ? <CreateCountDrawer categories={categories} items={items} message={message} pending={pendingAction === "create"} stores={stores} suppliers={suppliers} onSubmit={(input) => void run("create", () => createInventoryCountDraftAction(input))} /> : null}
            {isCreatingBatch ? <CreateCountBatchDrawer message={message} pending={pendingAction === "batch"} stores={stores} onSubmit={(input) => void run("batch", () => createInventoryCountBatchAction(input))} /> : null}
            {selectedBatch ? <CountBatchDrawer batch={selectedBatch} onOpenCount={(countId) => { setSelectedBatchId(null); setSelectedCountId(countId); setMessage(null); }} /> : null}
            {selectedDocument ? <CountDetailDrawer
              canCreateCounts={canCreateCounts}
              canFinalizeCounts={canFinalizeCounts}
              document={selectedDocument}
              items={items}
              message={message}
              pendingAction={pendingAction}
              onCancel={() => void run("cancel", () => cancelInventoryCountAction({ inventoryCountId: selectedDocument.id, note: "Cancelled from Inventory Control" }))}
              onImport={(rows) => run("import", () => importInventoryCountLinesAction({ inventoryCountId: selectedDocument.id, rows }))}
              onPost={() => void run("post", () => postInventoryCountAction({ inventoryCountId: selectedDocument.id }))}
              onSaveLine={(line, quantity) => run("line", () => saveInventoryCountLineAction({ inventoryCountId: selectedDocument.id, productId: line.productId, variantId: line.variantId ?? "", countedQuantity: quantity }))}
              onSubmitForReview={() => void run("review", () => submitInventoryCountForReviewAction({ inventoryCountId: selectedDocument.id }))}
            /> : null}
          </BackOfficeDetailDrawer>
        </Dialog.Root>
      </section>
      {selectedDocument ? <CountPrintDocument document={selectedDocument} /> : null}
    </>
  );
}

function CountDocumentList({ documents, onSelect }: { documents: CountDocument[]; onSelect: (id: string) => void }) {
  return <div className="overflow-hidden rounded-xl border">
    <div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(8rem,.75fr)_7rem_7rem_8rem] gap-4 border-b bg-muted/30 px-4 py-3 text-xs font-medium text-muted-foreground md:grid"><span>Count</span><span>Store</span><span>Progress</span><span>Mode</span><span>Status</span></div>
    <div className="divide-y">{documents.map((document) => {
      const saved = document.lines.filter((line) => line.countedQuantity !== null).length;
      return <button aria-label={`View inventory count ${formatReference(document.countNumber)}`} className="grid w-full gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(8rem,1fr)_minmax(8rem,.75fr)_7rem_7rem_8rem] md:items-center md:gap-4" key={document.id} onClick={() => onSelect(document.id)} type="button">
        <span><span className="font-medium text-primary">{formatReference(document.countNumber)}</span><span className="mt-1 block text-xs text-muted-foreground">{document.note || formatDate(document.updatedAt)}</span></span>
        <span className="text-sm text-muted-foreground">{document.storeName}</span><span className="text-sm text-muted-foreground">{saved}/{document.lines.length}</span><span className="text-sm capitalize text-muted-foreground">{document.countMode}</span><span><Badge variant={statusVariant(document.status)}>{formatStatus(document.status)}</Badge></span>
      </button>;
    })}</div>
  </div>;
}

function CountBatchList({ batches, onSelect }: { batches: CountBatch[]; onSelect: (id: string) => void }) {
  return <div className="divide-y overflow-hidden rounded-xl border">{batches.map((batch) => {
    const total = batch.documents.reduce((sum, document) => sum + document.lines.length, 0);
    const counted = batch.documents.reduce((sum, document) => sum + document.lines.filter((line) => line.countedQuantity !== null).length, 0);
    const ready = batch.documents.filter((document) => document.status === "ready_for_review").length;
    return <button aria-label={`View inventory count batch ${formatBatchReference(batch.batchNumber)}`} className="grid w-full gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(12rem,1fr)_10rem_10rem] md:items-center md:gap-4" key={batch.id} onClick={() => onSelect(batch.id)} type="button">
      <span><span className="font-medium text-primary">{formatBatchReference(batch.batchNumber)}</span><span className="ml-2 font-medium">{batch.name}</span><span className="mt-1 block text-xs text-muted-foreground">{batch.documents.length} store{batch.documents.length === 1 ? "" : "s"} · {batch.note || formatDate(batch.updatedAt)}</span></span>
      <span className="text-sm text-muted-foreground">{counted}/{total || 0} counted</span><span className="text-sm text-muted-foreground">{ready ? `${ready} ready for review` : "In progress"}</span>
    </button>;
  })}</div>;
}

function CreateCountDrawer({ categories, items, message, onSubmit, pending, stores, suppliers }: { categories: Category[]; items: Item[]; message: string | null; onSubmit: (input: unknown) => void; pending: boolean; stores: Store[]; suppliers: Supplier[] }) {
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
  const submit = () => onSubmit({ storeId, note, countMode, scopeType, scopeReferenceId, selectedItems: selectedKeys.map((key) => { const [productId, variantId] = key.split("|"); return { productId, variantId }; }), sortMode, includeZeroStock });

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
      {scopeType === "selected" ? <section className="space-y-3 rounded-xl border p-4"><div><h3 className="font-medium">Choose products</h3><p className="mt-1 text-sm text-muted-foreground">Only active, inventory-tracked items available at this store are listed.</p></div><label className="relative block"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search product, SKU, or barcode" /></label><div className="max-h-56 divide-y overflow-y-auto rounded-lg border">{visibleItems.map((item) => { const key = itemKey(item); return <label className="flex min-h-11 items-start gap-3 px-3 py-2.5 text-sm hover:bg-muted/50" key={key}><input checked={selectedKeys.includes(key)} className="mt-0.5 size-4" onChange={(event) => setSelectedKeys((current) => event.target.checked ? [...current, key] : current.filter((value) => value !== key))} type="checkbox" /><span><span className="font-medium">{item.label}</span><span className="block text-xs text-muted-foreground">{item.categoryName}{item.sku ? ` · ${item.sku}` : ""}</span></span></label>; })}{visibleItems.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No matching products are available in this store.</p> : null}</div><p className="text-xs text-muted-foreground">{selectedKeys.length} selected</p></section> : null}
      <label className="flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm"><input checked={includeZeroStock} className="mt-0.5 size-4" onChange={(event) => setIncludeZeroStock(event.target.checked)} type="checkbox" /><span><span className="font-medium">Include zero-stock items</span><span className="mt-0.5 block text-xs text-muted-foreground">Recommended for full counts so physically found stock is not missed.</span></span></label>
      <Field label="Count note (optional)"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. September full stocktake" /></Field>
      <p className="rounded-lg border bg-muted/20 p-3 text-sm text-muted-foreground">The screen, printed sheet, and spreadsheet template use this prepared document&apos;s same saved order. Blind counts omit expected quantities from every output.</p><ResultMessage result={message} />
    </DialogBody>
    <DialogFooter className="border-t px-4 py-4 sm:px-6"><Button disabled={pending || !storeId} onClick={submit} type="button">{pending ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}{pending ? "Preparing count…" : "Prepare count"}</Button></DialogFooter>
  </>;
}

function CreateCountBatchDrawer({ message, onSubmit, pending, stores }: { message: string | null; onSubmit: (input: unknown) => void; pending: boolean; stores: Store[] }) {
  const [name, setName] = useState(() => `Stocktake ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date())}`);
  const [note, setNote] = useState("");
  const [storeIds, setStoreIds] = useState<string[]>(stores.map((store) => store.id));
  const [countMode, setCountMode] = useState<CountMode>("standard");
  const [sortMode, setSortMode] = useState<SortMode>("category_name");
  const [includeZeroStock, setIncludeZeroStock] = useState(true);
  const submit = () => onSubmit({ name, note, storeIds, countMode, sortMode, includeZeroStock });
  return <>
    <DialogHeader><DialogTitle>New multi-store count batch</DialogTitle><DialogDescription>This prepares one independent full-store count document per selected store. The batch coordinates work; it does not share stock or post a combined variance.</DialogDescription></DialogHeader>
    <DialogBody className="flex-1 max-h-none space-y-5">
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Batch name"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. September full stocktake" /></Field><Field label="Count mode"><select className={selectClassName} value={countMode} onChange={(event) => setCountMode(event.target.value as CountMode)}><option value="standard">Standard — show expected quantity</option><option value="blind">Blind — hide expected quantity</option></select></Field><Field label="Sort count sheets"><select className={selectClassName} value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="category_name">Category → product → variant</option><option value="product_name">Product name</option><option value="supplier_name">Supplier</option><option value="sku">SKU</option><option value="barcode">Barcode</option></select></Field><Field label="Batch scope"><Input disabled value="Full store for each selected store" /></Field></div>
      <section className="space-y-3 rounded-xl border p-4"><div><h3 className="font-medium">Stores in this batch</h3><p className="mt-1 text-sm text-muted-foreground">You need at least two stores. Each store receives its own count document and can be counted, reviewed, or finalized independently.</p></div><div className="grid gap-2 sm:grid-cols-2">{stores.map((store) => <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm" key={store.id}><input checked={storeIds.includes(store.id)} className="size-4" onChange={(event) => setStoreIds((current) => event.target.checked ? [...current, store.id] : current.filter((id) => id !== store.id))} type="checkbox" /><span>{store.name}</span></label>)}</div><p className="text-xs text-muted-foreground">{storeIds.length} selected</p></section>
      <label className="flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm"><input checked={includeZeroStock} className="mt-0.5 size-4" onChange={(event) => setIncludeZeroStock(event.target.checked)} type="checkbox" /><span><span className="font-medium">Include zero-stock items</span><span className="mt-0.5 block text-xs text-muted-foreground">Recommended for physical stocktakes so found items are not missed.</span></span></label>
      <Field label="Batch note (optional)"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. All branches before month end" /></Field><ResultMessage result={message} />
    </DialogBody>
    <DialogFooter className="border-t px-4 py-4 sm:px-6"><Button disabled={pending || name.trim().length === 0 || storeIds.length < 2} onClick={submit} type="button">{pending ? <LoaderCircle className="animate-spin" /> : <Layers3 />}{pending ? "Preparing batch…" : "Prepare count batch"}</Button></DialogFooter>
  </>;
}

function CountBatchDrawer({ batch, onOpenCount }: { batch: CountBatch; onOpenCount: (countId: string) => void }) {
  const total = batch.documents.reduce((sum, document) => sum + document.lines.length, 0);
  const counted = batch.documents.reduce((sum, document) => sum + document.lines.filter((line) => line.countedQuantity !== null).length, 0);
  return <><DialogHeader><DialogTitle>{formatBatchReference(batch.batchNumber)} · {batch.name}</DialogTitle><DialogDescription>Prepared {formatDate(batch.createdAt)}. Each row opens that store&apos;s authoritative count document.</DialogDescription></DialogHeader><DialogBody className="flex-1 max-h-none space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="Stores" value={String(batch.documents.length)} /><Metric label="Items counted" value={`${counted}/${total || 0}`} /><Metric label="Ready for review" value={String(batch.documents.filter((document) => document.status === "ready_for_review").length)} /></div>{batch.note ? <section><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</p><p className="mt-1 text-sm">{batch.note}</p></section> : null}<section><h3 className="font-medium">Store counts</h3><div className="mt-3 divide-y overflow-hidden rounded-xl border">{batch.documents.map((document) => { const documentCounted = document.lines.filter((line) => line.countedQuantity !== null).length; const varianceCount = document.lines.filter((line) => line.countedQuantity !== null && line.reconciledExpectedQuantity !== null && line.countedQuantity !== line.reconciledExpectedQuantity).length; return <button className="grid w-full gap-2 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(10rem,1fr)_8rem_8rem] sm:items-center" key={document.id} onClick={() => onOpenCount(document.id)} type="button"><span><span className="font-medium text-primary">{document.storeName}</span><span className="ml-2 text-sm text-muted-foreground">{formatReference(document.countNumber)}</span></span><span className="text-sm text-muted-foreground">{documentCounted}/{document.lines.length} counted</span><span className="flex items-center justify-between gap-2"><span className="text-sm text-muted-foreground">{varianceCount} variance{varianceCount === 1 ? "" : "s"}</span><Badge variant={statusVariant(document.status)}>{formatStatus(document.status)}</Badge></span></button>; })}</div></section></DialogBody></>;
}

function CountDetailDrawer({ canCreateCounts, canFinalizeCounts, document, items, message, onCancel, onImport, onPost, onSaveLine, onSubmitForReview, pendingAction }: {
  canCreateCounts: boolean;
  canFinalizeCounts: boolean;
  document: CountDocument;
  items: Item[];
  message: string | null;
  onCancel: () => void;
  onImport: (rows: ImportRow[]) => Promise<boolean>;
  onPost: () => void;
  onSaveLine: (line: Pick<CountLine, "productId" | "variantId">, quantity: string) => Promise<boolean>;
  onSubmitForReview: () => void;
  pendingAction: PendingAction;
}) {
  const editable = (document.status === "draft" || document.status === "in_progress") && canCreateCounts;
  const uncounted = document.lines.filter((line) => line.countedQuantity === null);
  const [productKey, setProductKey] = useState(() => uncounted[0] ? itemKey(uncounted[0]) : document.lines[0] ? itemKey(document.lines[0]) : "");
  const [quantity, setQuantity] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedLine = document.lines.find((line) => itemKey(line) === productKey) ?? null;
  const selectedItem = selectedLine ?? items.find((item) => itemKey(item) === productKey && item.storeIds.includes(document.storeId)) ?? null;
  const unexpectedItems = items.filter((item) => item.storeIds.includes(document.storeId) && !document.lines.some((line) => itemKey(line) === itemKey(item)));
  const matched = document.lines.filter((line) => line.countedQuantity !== null && line.countedQuantity === reconciliationExpected(line)).length;
  const short = document.lines.filter((line) => line.countedQuantity !== null && line.countedQuantity < reconciliationExpected(line)).length;
  const over = document.lines.filter((line) => line.countedQuantity !== null && line.countedQuantity > reconciliationExpected(line)).length;
  const canImport = Boolean(preview && preview.rows.length > 0 && preview.invalid === 0 && preview.duplicate === 0 && preview.unknown === 0);

  const saveLine = async () => { if (!selectedItem || quantity === "") return; const ok = await onSaveLine(selectedItem, quantity); if (ok) setQuantity(""); };
  const print = () => { const cleanup = () => documentBodyCleanup(); window.document.body.dataset.printMode = "inventory-count"; window.addEventListener("afterprint", cleanup, { once: true }); window.print(); window.setTimeout(cleanup, 1000); };
  const chooseImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPreview(await previewCountCsv(file, document));
  };
  const importRows = async () => { if (!preview || !canImport) return; const ok = await onImport(preview.rows); if (ok) setPreview(null); };

  return <>
    <DialogHeader><div className="flex items-start justify-between gap-3"><div><DialogTitle>{formatReference(document.countNumber)}</DialogTitle><DialogDescription>{document.storeName} · {formatScope(document.scopeType)} · prepared {formatDate(document.startedAt)}</DialogDescription></div><Badge variant={statusVariant(document.status)}>{formatStatus(document.status)}</Badge></div></DialogHeader>
    <DialogBody className="flex-1 max-h-none space-y-5">
      <div className="flex flex-wrap gap-2"><Badge variant="outline">{document.countMode === "blind" ? "Blind count" : "Standard count"}</Badge><Badge variant="outline">{formatSort(document.sortMode)}</Badge><Badge variant="outline">{document.includeZeroStock ? "Includes zero stock" : "Non-zero stock"}</Badge></div>
      {document.note ? <section><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Note</p><p className="mt-1 text-sm">{document.note}</p></section> : null}
      <div className="grid gap-3 sm:grid-cols-3"><Metric label="Counted" value={`${document.lines.length - uncounted.length}/${document.lines.length}`} />{document.countMode === "standard" ? <><Metric label="Matched" value={String(matched)} /><Metric label="Short / over" value={`${short} / ${over}`} /></> : <Metric label="Mode" value="Expected hidden" />}</div>
      {editable ? <form className="space-y-3 rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); void saveLine(); }}><div><h3 className="font-medium">Record physical quantity</h3><p className="mt-1 text-sm text-muted-foreground">Progress is saved to this count document. Stock changes only after review and posting.</p></div><Field label="Prepared item"><select className={selectClassName} value={productKey} onChange={(event) => { setProductKey(event.target.value); setQuantity(""); }}><optgroup label="Prepared count sheet">{document.lines.map((line) => <option key={itemKey(line)} value={itemKey(line)}>{line.countedQuantity === null ? "○" : "✓"} {line.label}</option>)}</optgroup>{unexpectedItems.length ? <optgroup label="Unexpected item found">{unexpectedItems.map((item) => <option key={itemKey(item)} value={itemKey(item)}>{item.label}</option>)}</optgroup> : null}</select></Field><Field label="Physical quantity"><Input inputMode="decimal" min="0" onChange={(event) => setQuantity(event.target.value)} placeholder={selectedLine?.countedQuantity === null ? "0" : String(selectedLine?.countedQuantity ?? 0)} step="0.001" type="number" value={quantity} /></Field><Button disabled={pendingAction === "line" || !selectedItem || quantity === ""} type="submit">{pendingAction === "line" ? <LoaderCircle className="animate-spin" /> : <PackagePlus />}{pendingAction === "line" ? "Saving item…" : "Save item"}</Button></form> : null}
      <section aria-labelledby="count-sheet-title"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-medium" id="count-sheet-title">Count sheet</h3><p className="mt-1 text-sm text-muted-foreground">Prepared items remain in their saved order. {document.countMode === "blind" ? "Expected quantities stay hidden." : "The snapshot remains historical; reconciliation reflects authoritative stock when each physical quantity was saved."}</p></div><div className="flex flex-wrap gap-2"><Button onClick={print} size="sm" type="button" variant="outline"><Printer />Print</Button><Button onClick={() => downloadCountCsv(document)} size="sm" type="button" variant="outline"><FileSpreadsheet />Spreadsheet CSV</Button>{editable ? <><input accept=".csv,text/csv" className="sr-only" onChange={(event) => void chooseImportFile(event)} ref={fileInputRef} type="file" /><Button onClick={() => fileInputRef.current?.click()} size="sm" type="button" variant="outline"><FileUp />Import CSV</Button></> : null}</div></div>
        {preview ? <ImportPreviewCard preview={preview} pending={pendingAction === "import"} onClear={() => setPreview(null)} onImport={() => void importRows()} /> : null}
        <div className="mt-3 overflow-x-auto rounded-xl border"><table className="w-full min-w-[42rem] text-sm"><thead className="bg-muted/30 text-left text-xs text-muted-foreground"><tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">SKU / barcode</th>{document.countMode === "standard" ? <><th className="px-3 py-2 text-right">Snapshot</th><th className="px-3 py-2 text-right">Reconciled</th></> : null}<th className="px-3 py-2 text-right">Counted</th>{document.countMode === "standard" ? <th className="px-3 py-2 text-right">Variance</th> : null}</tr></thead><tbody className="divide-y">{document.lines.map((line) => { const variance = line.countedQuantity === null || line.reconciledExpectedQuantity === null ? null : line.countedQuantity - line.reconciledExpectedQuantity; return <tr key={line.id}><td className="px-3 py-2"><span className="font-medium">{line.label}</span><span className="block text-xs text-muted-foreground">{line.categoryName}</span></td><td className="px-3 py-2 text-muted-foreground">{line.sku || line.barcode || "—"}</td>{document.countMode === "standard" ? <><td className="px-3 py-2 text-right">{formatQuantity(line.expectedQuantity)}</td><td className="px-3 py-2 text-right">{line.reconciledExpectedQuantity === null ? <span className="text-muted-foreground">Not reconciled</span> : formatQuantity(line.reconciledExpectedQuantity)}</td></> : null}<td className="px-3 py-2 text-right">{line.countedQuantity === null ? <span className="text-muted-foreground">Not counted</span> : formatQuantity(line.countedQuantity)}</td>{document.countMode === "standard" ? <td className="px-3 py-2 text-right">{variance === null ? "—" : `${variance > 0 ? "+" : ""}${formatQuantity(variance)}`}</td> : null}</tr>; })}</tbody></table></div>
      </section><ResultMessage result={message} />
    </DialogBody>
    <DialogFooter className="justify-end border-t px-4 py-4 sm:px-6">{canFinalizeCounts && (document.status === "draft" || document.status === "in_progress" || document.status === "ready_for_review") ? <Button disabled={pendingAction === "cancel"} onClick={onCancel} type="button" variant="outline">{pendingAction === "cancel" ? <LoaderCircle className="animate-spin" /> : <XCircle />}{pendingAction === "cancel" ? "Cancelling…" : "Cancel count"}</Button> : null}{canFinalizeCounts && (document.status === "draft" || document.status === "in_progress") ? <Button disabled={pendingAction === "review" || uncounted.length > 0} onClick={onSubmitForReview} type="button">{pendingAction === "review" ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}{uncounted.length ? `${uncounted.length} left to count` : pendingAction === "review" ? "Submitting…" : "Submit for review"}</Button> : null}{canFinalizeCounts && document.status === "ready_for_review" ? <Button disabled={pendingAction === "post"} onClick={onPost} type="button">{pendingAction === "post" ? <LoaderCircle className="animate-spin" /> : <ClipboardCheck />}{pendingAction === "post" ? "Posting…" : "Post reviewed variance"}</Button> : null}</DialogFooter>
  </>;
}

function ImportPreviewCard({ onClear, onImport, pending, preview }: { onClear: () => void; onImport: () => void; pending: boolean; preview: ImportPreview }) {
  const blocked = preview.invalid > 0 || preview.duplicate > 0 || preview.unknown > 0 || preview.rows.length === 0;
  return <section className="mt-3 rounded-xl border bg-muted/20 p-4" aria-live="polite"><div className="flex flex-wrap items-start justify-between gap-3"><div><h4 className="font-medium">Spreadsheet import preview</h4><p className="mt-1 text-sm text-muted-foreground">Only the official count spreadsheet can update this count. Blank cells remain uncounted; an explicit 0 records a physical zero.</p></div><Button onClick={onClear} size="sm" type="button" variant="ghost">Clear</Button></div>{preview.message ? <p className="mt-3 text-sm text-destructive">{preview.message}</p> : <><dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3"><PreviewMetric label="Rows detected" value={preview.detected} /><PreviewMetric label="Valid" value={preview.rows.length} /><PreviewMetric label="Missing" value={preview.missing} /><PreviewMetric label="Invalid" value={preview.invalid} /><PreviewMetric label="Duplicate" value={preview.duplicate} /><PreviewMetric label="Unknown" value={preview.unknown} /></dl>{blocked ? <p className="mt-3 text-sm text-destructive">Correct the invalid, duplicate, or unknown rows before importing. No physical quantities have been saved.</p> : <div className="mt-3 flex flex-wrap items-center gap-3"><Button disabled={pending} onClick={onImport} size="sm" type="button">{pending ? <LoaderCircle className="animate-spin" /> : <FileUp />}{pending ? "Importing…" : `Import ${preview.rows.length} ${preview.rows.length === 1 ? "quantity" : "quantities"}`}</Button>{preview.missing ? <span className="text-xs text-muted-foreground">{preview.missing} count line{preview.missing === 1 ? " remains" : "s remain"} uncounted.</span> : null}</div>}</>}</section>;
}

function CountPrintDocument({ document }: { document: CountDocument }) {
  return <article className="hidden" data-inventory-count-print-document><header data-inventory-print-header><p>TINDIO INVENTORY COUNT</p><h1>{formatReference(document.countNumber)}</h1><dl><div><dt>Store</dt><dd>{document.storeName}</dd></div><div><dt>Prepared</dt><dd>{formatDate(document.startedAt)}</dd></div><div><dt>Prepared by</dt><dd>{document.preparedBy}</dd></div><div><dt>Scope</dt><dd>{formatScope(document.scopeType)}</dd></div><div><dt>Mode</dt><dd className="capitalize">{document.countMode}</dd></div><div><dt>Prepared order</dt><dd>{formatSort(document.sortMode)}</dd></div></dl></header><table data-inventory-print-table><thead><tr><th>Item</th><th>Category</th><th>SKU / barcode</th>{document.countMode === "standard" ? <th>System Qty</th> : null}<th>Physical Count</th></tr></thead><tbody>{document.lines.map((line) => <tr key={line.id}><td>{line.label}<br /><span>{line.unit}</span></td><td>{line.categoryName}</td><td>{line.sku || line.barcode || "—"}</td>{document.countMode === "standard" ? <td>{formatQuantity(line.expectedQuantity)}</td> : null}<td>{line.countedQuantity === null ? "________________" : formatQuantity(line.countedQuantity)}</td></tr>)}</tbody></table><p data-inventory-print-unexpected>Unexpected item found: ________________________________________________________________</p></article>;
}

function downloadCountCsv(document: CountDocument) {
  const headers = ["Count reference", "Count ID", "Count line ID", "Store", "Store ID", "Product ID", "Variant ID", "Category", "Product", "SKU", "Barcode", "Unit", ...(document.countMode === "standard" ? ["Snapshot quantity", "Reconciled quantity"] : []), "Counted quantity"];
  const rows = document.lines.map((line) => [formatReference(document.countNumber), document.id, line.id, document.storeName, document.storeId, line.productId, line.variantId ?? "", line.categoryName, line.label, line.sku ?? "", line.barcode ?? "", line.unit, ...(document.countMode === "standard" ? [line.expectedQuantity, line.reconciledExpectedQuantity ?? ""] : []), line.countedQuantity ?? ""]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = `${formatReference(document.countNumber)}-${document.storeName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-count-template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function previewCountCsv(file: File, document: CountDocument): Promise<ImportPreview> {
  const empty: ImportPreview = { detected: 0, duplicate: 0, invalid: 0, message: null, missing: 0, rows: [], unknown: 0 };
  if (file.size > 2_000_000) return { ...empty, message: "Choose a count spreadsheet smaller than 2 MB." };
  const parsed = parseCsv(await file.text());
  if (parsed.length < 2) return { ...empty, message: "This spreadsheet has no count rows." };
  const headerIndex = new Map(parsed[0].map((header, index) => [header.trim().toLowerCase(), index]));
  const required = ["count reference", "count id", "count line id", "store id", "product id", "variant id", "counted quantity"];
  if (required.some((header) => !headerIndex.has(header))) return { ...empty, message: "Choose the official TINDIO count spreadsheet exported from this count document." };
  const cell = (row: string[], header: string) => row[headerIndex.get(header) ?? -1]?.trim() ?? "";
  const knownLines = new Map(document.lines.map((line) => [line.id, line]));
  const seen = new Set<string>();
  const result = { ...empty };
  for (const row of parsed.slice(1)) {
    if (row.every((value) => value.trim() === "")) continue;
    result.detected += 1;
    const countLineId = cell(row, "count line id");
    const countedQuantity = cell(row, "counted quantity");
    if (cell(row, "count reference") !== formatReference(document.countNumber) || cell(row, "count id") !== document.id || cell(row, "store id") !== document.storeId) { result.invalid += 1; continue; }
    if (seen.has(countLineId)) { result.duplicate += 1; continue; }
    seen.add(countLineId);
    const knownLine = knownLines.get(countLineId);
    if (!knownLine) { result.unknown += 1; continue; }
    if (cell(row, "product id") !== knownLine.productId || cell(row, "variant id") !== (knownLine.variantId ?? "")) { result.invalid += 1; continue; }
    if (countedQuantity === "") { result.missing += 1; continue; }
    if (!quantityPattern.test(countedQuantity)) { result.invalid += 1; continue; }
    result.rows.push({ countLineId, productId: knownLine.productId, variantId: knownLine.variantId ?? "", countedQuantity: Number(countedQuantity) });
  }
  result.missing += document.lines.filter((line) => !seen.has(line.id)).length;
  return result;
}

function parseCsv(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted && character === '"' && input[index + 1] === '"') { value += '"'; index += 1; continue; }
    if (character === '"') { quoted = !quoted; continue; }
    if (!quoted && character === ",") { row.push(value); value = ""; continue; }
    if (!quoted && (character === "\n" || character === "\r")) { if (character === "\r" && input[index + 1] === "\n") index += 1; row.push(value); rows.push(row); row = []; value = ""; continue; }
    value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

function documentBodyCleanup() { window.document.body.removeAttribute("data-print-mode"); }
function csvCell(value: string | number) { return `"${String(value).replaceAll('"', '""')}"`; }
function itemKey(item: Pick<Item, "productId" | "variantId"> | Pick<CountLine, "productId" | "variantId">) { return `${item.productId}|${item.variantId ?? ""}`; }
function reconciliationExpected(line: CountLine) { return line.reconciledExpectedQuantity ?? line.expectedQuantity; }
function Field({ children, label }: { children: ReactNode; label: string }) { return <label className="grid gap-1.5 text-sm font-medium"><span>{label}</span>{children}</label>; }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border bg-muted/20 p-3"><p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p><p className="mt-1 text-lg font-semibold">{value}</p></div>; }
function PreviewMetric({ label, value }: { label: string; value: number }) { return <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>; }
function ResultMessage({ result }: { result: string | null }) { return result ? <p aria-live="polite" className="text-sm text-muted-foreground">{result}</p> : null; }
function formatReference(countNumber: number) { return `IC-${String(countNumber).padStart(6, "0")}`; }
function formatBatchReference(batchNumber: number) { return `CB-${String(batchNumber).padStart(6, "0")}`; }
function formatQuantity(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatStatus(status: CountStatus) { return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function formatScope(scope: ScopeType) { return ({ full_store: "Full store", category: "Category", supplier: "Supplier", selected: "Selected products" } as const)[scope]; }
function formatSort(sort: SortMode) { return ({ category_name: "Category → product → variant", supplier_name: "Supplier", sku: "SKU", barcode: "Barcode", product_name: "Product name" } as const)[sort]; }
function statusVariant(status: CountStatus) { return status === "posted" || status === "completed" ? "secondary" : status === "cancelled" ? "outline" : "default"; }
