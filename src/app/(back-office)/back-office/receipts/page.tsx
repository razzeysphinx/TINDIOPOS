import { ChevronRight, ReceiptText, RotateCcw } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
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

function firstString(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function formatReceiptDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
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
          action={<Badge variant="outline">No receipt access</Badge>}
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
  const [refundsResult, paymentsResult] = saleIds.length > 0
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
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (refundsResult.error || paymentsResult.error) {
    throw new Error(`Unable to load receipt summaries: ${refundsResult.error?.message ?? paymentsResult.error?.message}`);
  }

  const refundTotalBySale = new Map<string, number>();
  for (const refund of refundsResult.data ?? []) {
    refundTotalBySale.set(refund.sale_id, (refundTotalBySale.get(refund.sale_id) ?? 0) + refund.total_minor);
  }
  const paymentNamesBySale = new Map<string, string[]>();
  for (const item of paymentsResult.data ?? []) {
    paymentNamesBySale.set(item.sale_id, [...(paymentNamesBySale.get(item.sale_id) ?? []), item.payment_method_name_snapshot]);
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
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value && key !== "before") query.set(key, value);
  }
  const querySuffix = query.size ? `&${query.toString()}` : "";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales"
        title="Receipts"
        description="Review completed transactions by authorized branch, register, cashier, payment method, and receipt number."
        action={<Badge variant="secondary">Receipt access</Badge>}
      />

      <GlobalFilterBar
        action="/back-office/receipts"
        additionalFields={(
          <>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Register<Input defaultValue={register} name="register" placeholder="Register" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Cashier<Input defaultValue={cashier} name="cashier" placeholder="Cashier" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Payment method<Input defaultValue={payment} name="payment" placeholder="Cash, card…" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Receipt number<Input defaultValue={parameters.receipt} inputMode="numeric" name="receipt" placeholder="000421" /></label>
            <label className="grid min-w-36 gap-1.5 text-sm font-medium">Sort<select className={selectClassName} defaultValue={sort} name="sort"><option value="newest">Date: newest</option><option value="store">Store: A–Z</option><option value="receipt">Receipt: newest</option></select></label>
            {!scope.selectedStoreId ? <label className="grid min-w-36 gap-1.5 text-sm font-medium">Grouping<select className={selectClassName} defaultValue={groupedByStore ? "store" : "none"} name="group"><option value="none">No grouping</option><option value="store">Group by store</option></select></label> : null}
          </>
        )}
        allowAllStores
        fromDate={parameters.start}
        namePrefix="receipt-filter"
        storeId={scope.selectedStoreId}
        stores={stores}
        toDate={parameters.end}
      />

      {receipts.length > 0 ? (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-225 text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Receipt</th>{!scope.selectedStoreId ? <th className="px-4 py-3 font-medium">Store</th> : null}<th className="px-4 py-3 font-medium">Register</th><th className="px-4 py-3 font-medium">Cashier</th><th className="px-4 py-3 font-medium">Date</th><th className="px-4 py-3 font-medium">Payment</th><th className="px-4 py-3 text-right font-medium">Total</th><th className="px-4 py-3" aria-label="Open receipt" /></tr></thead>
              {groups.map(([storeName, rows]) => (
                <tbody className="divide-y" key={storeName || "all"}>
                  {groupedByStore ? <tr className="bg-muted/20"><th className="px-4 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase" colSpan={scope.selectedStoreId ? 7 : 8}>{storeName}</th></tr> : null}
                  {rows.map((receipt) => {
                    const sale = receipt.sales;
                    const refundedMinor = refundTotalBySale.get(receipt.sale_id) ?? 0;
                    const fullyRefunded = sale ? refundedMinor >= sale.total_minor : false;
                    return <tr className="transition-colors hover:bg-muted/40" key={receipt.id}>
                      <td className="px-4 py-3"><Link className="font-mono font-semibold text-primary hover:underline" href={`/back-office/receipts/${receipt.id}`}>#{receipt.receipt_number}</Link>{refundedMinor > 0 ? <Badge className="mt-1" variant={fullyRefunded ? "outline" : "secondary"}><RotateCcw aria-hidden="true" />{fullyRefunded ? "Refunded" : "Partial"}</Badge> : null}</td>
                      {!scope.selectedStoreId ? <td className="px-4 py-3 font-medium">{sale?.store_name_snapshot ?? "Unavailable store"}</td> : null}
                      <td className="px-4 py-3 text-muted-foreground">{sale?.register_name_snapshot ?? "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{sale?.cashier_name_snapshot ?? "Cashier unavailable"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{formatReceiptDate(receipt.issued_at, context.organization.timezone)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{(paymentNamesBySale.get(receipt.sale_id) ?? []).join(", ") || "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold">{sale ? formatMinorMoney(sale.total_minor, sale.currency_code) : "—"}</td>
                      <td className="px-4 py-3 text-right"><Link aria-label={`Open receipt ${receipt.receipt_number}`} className="inline-flex text-muted-foreground hover:text-primary" href={`/back-office/receipts/${receipt.id}`}><ChevronRight className="size-4" aria-hidden="true" /></Link></td>
                    </tr>;
                  })}
                </tbody>
              ))}
            </table>
          </CardContent>
        </Card>
      ) : (
        <BackOfficeStateCard description="Completed POS sales matching these authorized branch filters will appear here." icon={<ReceiptText className="size-5" aria-hidden="true" />} title="No receipts found" />
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {beforeReceiptNumber !== null ? <Link className="text-sm font-medium text-primary hover:underline" href={`/back-office/receipts?${query.toString()}`}>Show newest receipts</Link> : <span />}
        {nextBefore ? <Link className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" href={`/back-office/receipts?before=${nextBefore}${querySuffix}`}>Load older receipts<ChevronRight className="size-4" aria-hidden="true" /></Link> : null}
      </div>
    </div>
  );
}
