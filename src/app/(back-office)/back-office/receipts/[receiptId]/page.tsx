import { ArrowLeft, ReceiptText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { RefundForm } from "@/features/receipts/refund-form";
import { ReceiptDeliveryForm } from "@/features/receipts/receipt-delivery-form";
import { ReceiptDocument } from "@/features/receipts/receipt-document";
import { loadAuthorizedReceiptDetail } from "@/features/receipts/detail/data";
import { ReceiptPrintButton } from "@/features/receipts/receipt-print-button";
import { SaleExchangeForm } from "@/features/receipts/sale-exchange-form";
import { cn } from "@/lib/utils";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Receipt" };

export default async function ReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ receiptId: string }>;
  searchParams: Promise<{ refund?: string }>;
}) {
  const [{ receiptId }, parameters] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) {
    notFound();
  }

  const context = await requireBackOfficePermission("receipts.view");
  if (!hasPermission(context, "receipts.view")) notFound();

  const detail = await loadAuthorizedReceiptDetail(context, receiptId);
  if (!detail) notFound();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Sales · Receipt"
        title={`Receipt #${detail.receipt.number}`}
        description="This receipt is rendered from immutable sale, payment, and refund snapshots."
        action={
          <div className="flex flex-wrap gap-2 print:hidden">
            <Link className={cn(buttonVariants({ variant: "outline" }))} href="/back-office/receipts">
              <ArrowLeft aria-hidden="true" />
              All receipts
            </Link>
            {detail.canReprint ? <ReceiptPrintButton /> : null}
          </div>
        }
      />

      <ReceiptDocument
        cashierName={detail.sale.cashierName}
        currencyCode={detail.sale.currencyCode}
        discountMinor={detail.sale.discountMinor}
        issuedAt={detail.receipt.issuedAt}
        layout={detail.receiptLayout}
        lines={detail.documentLines}
        payments={detail.documentPayments}
        receiptNumber={detail.receipt.number}
        refunds={detail.documentRefunds}
        registerName={detail.sale.registerName}
        subtotalMinor={detail.sale.subtotalMinor}
        taxMinor={detail.sale.taxMinor}
        timezone={context.organization.timezone}
        totalMinor={detail.sale.totalMinor}
      />

      {detail.canReprint ? <ReceiptDeliveryForm deliveries={detail.deliveries} receiptId={detail.receipt.id} /> : null}
      {detail.canRecordExchange ? <SaleExchangeForm currencyCode={detail.sale.currencyCode} refunds={detail.exchangeReturns} /> : null}

      {detail.canRefund ? (
        <RefundForm
          autoFocus={parameters.refund === "1"}
          currencyCode={detail.sale.currencyCode}
          items={detail.refundFormItems}
          originalTotalMinor={detail.sale.totalMinor}
          paymentMethods={detail.refundPaymentMethods}
          receiptNumber={detail.receipt.number}
          receiptId={detail.receipt.id}
          saleId={detail.sale.id}
        />
      ) : (
        <Card>
          <CardHeader className="flex-row items-start gap-3">
            <ReceiptText className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
            <div>
              <CardTitle>Refund processing is restricted</CardTitle>
              <CardDescription className="mt-1">
                Your role can view this receipt, but cannot process a refund for this store.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
