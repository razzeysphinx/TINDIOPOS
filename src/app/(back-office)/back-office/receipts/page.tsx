import { ChevronRight, ReceiptText, RotateCcw } from "lucide-react";
import Link from "next/link";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMinorMoney } from "@/features/catalog/catalog-money";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Receipts" };

const PAGE_SIZE = 25;

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
  searchParams: Promise<{ before?: string }>;
}) {
  const context = await requireBusinessContext();
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
        <Card>
          <CardHeader>
            <CardTitle>Receipt access is required</CardTitle>
            <CardDescription>
              Ask an owner to add the receipts.view permission to one of your roles.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const parameters = await searchParams;
  const parsedBefore = Number(parameters.before);
  const beforeReceiptNumber =
    Number.isSafeInteger(parsedBefore) && parsedBefore > 0 ? parsedBefore : null;
  const supabase = await createClient();

  let receiptsQuery = supabase
    .from("receipts")
    .select("id, sale_id, receipt_number, issued_at")
    .eq("organization_id", context.organization.id)
    .order("receipt_number", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (beforeReceiptNumber !== null) {
    receiptsQuery = receiptsQuery.lt("receipt_number", beforeReceiptNumber);
  }

  const { data: receiptRows, error: receiptError } = await receiptsQuery;
  if (receiptError) {
    throw new Error(`Unable to load receipt history: ${receiptError.message}`);
  }

  const hasMore = (receiptRows?.length ?? 0) > PAGE_SIZE;
  const receipts = (receiptRows ?? []).slice(0, PAGE_SIZE);
  const saleIds = receipts.map((receipt) => receipt.sale_id);
  const [salesResult, refundsResult] = saleIds.length > 0
    ? await Promise.all([
        supabase
          .from("sales")
          .select(
            "id, store_name_snapshot, cashier_name_snapshot, total_minor, currency_code, completed_at",
          )
          .in("id", saleIds),
        supabase
          .from("refunds")
          .select("sale_id, total_minor")
          .eq("organization_id", context.organization.id)
          .in("sale_id", saleIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];

  if (salesResult.error || refundsResult.error) {
    throw new Error(
      `Unable to load receipt summaries: ${salesResult.error?.message ?? refundsResult.error?.message}`,
    );
  }

  const saleById = new Map((salesResult.data ?? []).map((sale) => [sale.id, sale]));
  const refundTotalBySale = new Map<string, number>();
  for (const refund of refundsResult.data ?? []) {
    refundTotalBySale.set(
      refund.sale_id,
      (refundTotalBySale.get(refund.sale_id) ?? 0) + refund.total_minor,
    );
  }
  const nextBefore = hasMore ? receipts.at(-1)?.receipt_number : undefined;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales"
        title="Receipts"
        description="Review completed transactions, open their stored snapshots, reprint receipts, and trace any recorded returns."
        action={<Badge variant="secondary">Receipt access</Badge>}
      />

      {receipts.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {receipts.map((receipt) => {
                const sale = saleById.get(receipt.sale_id);
                const refundedMinor = refundTotalBySale.get(receipt.sale_id) ?? 0;
                const fullyRefunded = sale ? refundedMinor >= sale.total_minor : false;

                return (
                  <Link
                    className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/40 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto_auto] sm:items-center sm:px-5"
                    href={`/back-office/receipts/${receipt.id}`}
                    key={receipt.id}
                  >
                    <div>
                      <p className="font-mono text-sm font-semibold">#{receipt.receipt_number}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatReceiptDate(receipt.issued_at, context.organization.timezone)}
                      </p>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{sale?.store_name_snapshot ?? "Completed sale"}</p>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {sale?.cashier_name_snapshot ?? "Cashier unavailable"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                      {refundedMinor > 0 ? (
                        <Badge variant={fullyRefunded ? "outline" : "secondary"}>
                          <RotateCcw aria-hidden="true" />
                          {fullyRefunded ? "Refunded" : "Partially refunded"}
                        </Badge>
                      ) : (
                        <Badge variant="outline">Completed</Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <p className="font-semibold">
                        {sale ? formatMinorMoney(sale.total_minor, sale.currency_code) : "—"}
                      </p>
                      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="items-center py-12 text-center">
            <ReceiptText className="size-9 text-muted-foreground" aria-hidden="true" />
            <CardTitle>No receipts yet</CardTitle>
            <CardDescription>
              Completed POS sales will appear here with their stored transaction details.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {beforeReceiptNumber !== null ? (
          <Link className="text-sm font-medium text-primary hover:underline" href="/back-office/receipts">
            Show newest receipts
          </Link>
        ) : <span />}
        {nextBefore ? (
          <Link
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            href={`/back-office/receipts?before=${nextBefore}`}
          >
            Load older receipts
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </div>
  );
}
