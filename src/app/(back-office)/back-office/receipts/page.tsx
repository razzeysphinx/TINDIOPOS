import { ChevronRight, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ReceiptListQuickView } from "@/features/receipts/receipt-list-quick-view";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, hasStoreAccess, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Receipts" };

const PAGE_SIZE = 25;
const selectClassName =
  "h-8 min-w-36 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type ReceiptRow = {
  id: string;
  sale_id: string;
  receipt_number: number;
  issued_at: string;
  sales: {
    id: string;
    store_id: string;
    store_name_snapshot: string;
    register_name_snapshot: string;
    cashier_name_snapshot: string;
    total_minor: number;
    currency_code: string;
  } | null;
};

type SaleItemQuantity = {
  id: string;
  sale_id: string;
  quantity: number;
};

function firstString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{
    before?: string;
    cashier?: string;
    end?: string;
    group?: string;
    payment?: string;
    receipt?: string;
    register?: string;
    sort?: string;
    start?: string;
    store?: string;
  }>;
}) {
  const context = await requireBackOfficePermission("receipts.view");
  const canViewReceipts = hasPermission(context, "receipts.view");

  if (!canViewReceipts) {
    return (
      <div className="space-y-8">
        <PageHeader
          eyebrow="Sales"
          title="Receipts"
          description="Your role does not include access to completed transaction history."
        />
        <BackOfficeStateCard
          description="Ask an owner to add the receipts.view permission to one of your roles."
          icon={<ReceiptText className="size-5" aria-hidden="true" />}
          title="Receipt access is required"
        />
      </div>
    );
  }

  const parameters = await searchParams;
  const scope = resolveBackOfficeStoreScope(context, parameters);
  if (scope.invalidSelection) notFound();

  const beforeReceiptNumber = Number.isSafeInteger(Number(parameters.before)) && Number(parameters.before) > 0
    ? Number(parameters.before)
    : null;
  const receiptNumber = /^\d+$/.test(parameters.receipt ?? "") ? Number(parameters.receipt) : null;
  const cashier = firstString(parameters.cashier)?.trim();
  const register = firstString(parameters.register)?.trim();
  const payment = firstString(parameters.payment)?.trim();
  const sort = ["newest", "store", "receipt"].includes(parameters.sort ?? "") ? parameters.sort! : "newest";
  const groupedByStore = parameters.group === "store" && !scope.selectedStoreId;
  const supabase = await createClient();

  let receiptsQuery = supabase
    .from("receipts")
    .select(
      "id, sale_id, receipt_number, issued_at, sales!receipts_sale_organization_fkey!inner(id, store_id, store_name_snapshot, register_name_snapshot, cashier_name_snapshot, total_minor, currency_code)",
    )
    .eq("organization_id", context.organization.id)
    .order("receipt_number", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (scope.selectedStoreId) receiptsQuery = receiptsQuery.eq("sales.store_id", scope.selectedStoreId);
  if (beforeReceiptNumber !== null) receiptsQuery = receiptsQuery.lt("receipt_number", beforeReceiptNumber);
  if (receiptNumber !== null) receiptsQuery = receiptsQuery.eq("receipt_number", receiptNumber);
  if (parameters.receipt && receiptNumber === null) receiptsQuery = receiptsQuery.eq("receipt_number", -1);
  if (cashier) receiptsQuery = receiptsQuery.ilike("sales.cashier_name_snapshot", `%${cashier}%`);
  if (register) receiptsQuery = receiptsQuery.ilike("sales.register_name_snapshot", `%${register}%`);
  if (parameters.start) receiptsQuery = receiptsQuery.gte("issued_at", `${parameters.start}T00:00:00.000Z`);
  if (parameters.end) receiptsQuery = receiptsQuery.lte("issued_at", `${parameters.end}T23:59:59.999Z`);

  const [{ data: receiptData, error: receiptError }, stores] = await Promise.all([
    receiptsQuery,
    loadAuthorizedBackOfficeStores(context),
  ]);
  if (receiptError) throw new Error(`Unable to load receipt history: ${receiptError.message}`);

  const receiptRows = (receiptData ?? []) as unknown as ReceiptRow[];
  const hasMore = receiptRows.length > PAGE_SIZE;
  const initialReceipts = receiptRows.slice(0, PAGE_SIZE);
  const saleIds = initialReceipts.map((receipt) => receipt.sale_id);
  const [refundsResult, paymentsResult, saleItemsResult] = saleIds.length > 0
    ? await Promise.all([
        supabase
          .from("refunds")
          .select("sale_id, total_minor")
          .eq("organization_id", context.organization.id)
          .in("sale_id", saleIds),
        supabase
          .from("payments")
          .select("sale_id, payment_method_name_snapshot")
          .eq("organization_id", context.organization.id)
          .in("sale_id", saleIds),
        supabase
          .from("sale_items")
          .select("id, sale_id, quantity")
          .eq("organization_id", context.organization.id)
          .in("sale_id", saleIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  if (refundsResult.error || paymentsResult.error || saleItemsResult.error) {
    throw new Error(`Unable to load receipt summaries: ${refundsResult.error?.message ?? paymentsResult.error?.message ?? saleItemsResult.error?.message}`);
  }

  const saleItems = (saleItemsResult.data ?? []) as SaleItemQuantity[];
  const saleItemIds = saleItems.map((item) => item.id);
  const { data: refundItemData, error: refundItemsError } = saleItemIds.length > 0
    ? await supabase
        .from("refund_items")
        .select("sale_item_id, quantity")
        .eq("organization_id", context.organization.id)
        .in("sale_item_id", saleItemIds)
    : { data: [], error: null };

  if (refundItemsError) {
    throw new Error(`Unable to load refundable receipt quantities: ${refundItemsError.message}`);
  }

  const refundTotalBySale = new Map<string, number>();
  for (const refund of refundsResult.data ?? []) {
    refundTotalBySale.set(refund.sale_id, (refundTotalBySale.get(refund.sale_id) ?? 0) + refund.total_minor);
  }
  const paymentNamesBySale = new Map<string, string[]>();
  for (const item of paymentsResult.data ?? []) {
    paymentNamesBySale.set(item.sale_id, [...(paymentNamesBySale.get(item.sale_id) ?? []), item.payment_method_name_snapshot]);
  }
  const refundedQuantityBySaleItem = new Map<string, number>();
  for (const item of refundItemData ?? []) {
    refundedQuantityBySaleItem.set(
      item.sale_item_id,
      (refundedQuantityBySaleItem.get(item.sale_item_id) ?? 0) + item.quantity,
    );
  }
  const hasRefundableQuantityBySale = new Map<string, boolean>();
  for (const item of saleItems) {
    if (item.quantity > (refundedQuantityBySaleItem.get(item.id) ?? 0)) {
      hasRefundableQuantityBySale.set(item.sale_id, true);
    } else if (!hasRefundableQuantityBySale.has(item.sale_id)) {
      hasRefundableQuantityBySale.set(item.sale_id, false);
    }
  }

  const receipts = initialReceipts
    .filter((receipt) => !payment || (paymentNamesBySale.get(receipt.sale_id) ?? []).some((name) => name.toLocaleLowerCase().includes(payment.toLocaleLowerCase())))
    .sort((left, right) => {
      const leftSale = left.sales;
      const rightSale = right.sales;
      if (sort === "store") return (leftSale?.store_name_snapshot ?? "").localeCompare(rightSale?.store_name_snapshot ?? "") || right.receipt_number - left.receipt_number;
      if (sort === "receipt") return right.receipt_number - left.receipt_number;
      return right.issued_at.localeCompare(left.issued_at);
    });
  const nextBefore = hasMore ? initialReceipts.at(-1)?.receipt_number : undefined;
  const groups = groupedByStore
    ? Array.from(receipts.reduce((result, receipt) => {
      const key = receipt.sales?.store_name_snapshot ?? "Unknown store";
      result.set(key, [...(result.get(key) ?? []), receipt]);
      return result;
    }, new Map<string, ReceiptRow[]>()).entries())
    : [["", receipts] as [string, ReceiptRow[]]];
  const quickViewGroups = groups.map(([storeName, rows]) => ({
    storeName: groupedByStore ? storeName : null,
    items: rows.map((receipt) => {
      const sale = receipt.sales;
      const refundedMinor = refundTotalBySale.get(receipt.sale_id) ?? 0;
      const hasRefundableQuantity = hasRefundableQuantityBySale.get(receipt.sale_id) ?? false;
      const fullyRefunded = refundedMinor > 0 && !hasRefundableQuantity;
      return {
        canRefund: sale !== null && hasPermission(context, "sales.refund") && hasStoreAccess(context, sale.store_id),
        cashierName: sale?.cashier_name_snapshot ?? "Cashier unavailable",
        currencyCode: sale?.currency_code ?? context.organization.currency_code,
        fullReceiptHref: `/back-office/receipts/${receipt.id}`,
        id: receipt.id,
        issuedAt: receipt.issued_at,
        number: receipt.receipt_number,
        paymentNames: paymentNamesBySale.get(receipt.sale_id) ?? [],
        refundStatus: fullyRefunded ? "refunded" as const : refundedMinor > 0 ? "partially-refunded" as const : "available" as const,
        registerName: sale?.register_name_snapshot ?? "—",
        storeName: sale?.store_name_snapshot ?? "Unavailable store",
        totalMinor: sale?.total_minor ?? null,
      };
    }),
  }));
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value && key !== "before") query.set(key, value);
  }
  const querySuffix = query.size ? `&${query.toString()}` : "";
  const activeAdditionalFilterCount = [
    cashier,
    register,
    payment,
    parameters.receipt?.trim(),
    groupedByStore ? "group" : undefined,
  ].filter(Boolean).length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales"
        title="Receipts"
        description="Review completed transactions by store, register, cashier, payment method, and receipt number."
      />

      <Card>
        <CardContent className="space-y-4">
      <GlobalFilterBar
        action="/back-office/receipts"
        activeAdditionalFilterCount={activeAdditionalFilterCount}
        additionalFields={(
          <>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Register<Input defaultValue={register} name="register" placeholder="Register" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Cashier<Input defaultValue={cashier} name="cashier" placeholder="Cashier" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Payment method<Input defaultValue={payment} name="payment" placeholder="Cash, card…" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Receipt number<Input defaultValue={parameters.receipt} inputMode="numeric" name="receipt" placeholder="000421" /></label>
            {!scope.selectedStoreId ? <label className="grid min-w-36 gap-1.5 text-sm font-medium">Grouping<select className={selectClassName} defaultValue={groupedByStore ? "store" : "none"} name="group"><option value="none">No grouping</option><option value="store">Group by store</option></select></label> : null}
          </>
        )}
        allowAllStores
        collapsibleAdditionalFields
        embedded
        fromDate={parameters.start}
        namePrefix="receipt-filter"
        primaryAdditionalFields={<label className="grid min-w-36 gap-1.5 text-sm font-medium">Sort<select className={selectClassName} defaultValue={sort} name="sort"><option value="newest">Date: newest</option><option value="store">Store: A–Z</option><option value="receipt">Receipt: newest</option></select></label>}
        storeId={scope.selectedStoreId}
            stores={stores}
            toDate={parameters.end}
            showEmbeddedDividers={false}
          />

      {receipts.length > 0 ? (
        <ReceiptListQuickView groups={quickViewGroups} timezone={context.organization.timezone} />
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <ReceiptText className="mx-auto size-5 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-medium">No receipts found</p>
          <p className="mt-1 text-sm text-muted-foreground">Completed POS sales matching these authorized branch filters will appear here.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {beforeReceiptNumber !== null ? <Link className="text-sm font-medium text-primary hover:underline" href={`/back-office/receipts?${query.toString()}`}>Show newest receipts</Link> : <span />}
        {nextBefore ? <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={`/back-office/receipts?before=${nextBefore}${querySuffix}`}>Load older receipts<ChevronRight className="size-4" aria-hidden="true" /></Link> : null}
      </div>
        </CardContent>
      </Card>
    </div>
  );
}
