import { ArrowLeft, ReceiptText } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { notFound, redirect } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { RefundForm } from "@/features/receipts/refund-form";
import {
  ReceiptDocument,
  receiptLayoutFromSnapshot,
  type ReceiptPayment,
  type ReceiptRefund,
  type ReceiptSaleLine,
} from "@/features/receipts/receipt-document";
import { ReceiptPrintButton } from "@/features/receipts/receipt-print-button";
import { loadPosReceiptDetail, loadPosWorkspace } from "@/features/pos/data";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import { canAccessBackOffice, getPosNavigationCapabilities, getWorkspaceHome, hasPermission, hasStoreAccess, requireBusinessContext } from "@/lib/auth/dal";
import { cn } from "@/lib/utils";

export const metadata = { title: "POS receipt" };

export default async function PosReceiptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ receiptId: string }>;
  searchParams: Promise<{ refund?: string }>;
}) {
  await connection();
  const [{ receiptId }, parameters] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) {
    notFound();
  }

  const context = await requireBusinessContext();
  if (!hasPermission(context, "pos.access") || !hasPermission(context, "sales.create") || !hasPermission(context, "receipts.view")) redirect(getWorkspaceHome(context));
  const [workspace, detail] = await Promise.all([
    loadPosWorkspace(context),
    loadPosReceiptDetail(context, receiptId),
  ]);
  if (!detail) notFound();

  const receiptLayout = receiptLayoutFromSnapshot(detail.receipt.layout, {
    organizationName: detail.sale.organizationName,
    storeName: detail.sale.storeName,
  });
  const documentLines: ReceiptSaleLine[] = detail.items.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceMinor: item.unitPriceMinor,
    lineTotalMinor: item.lineTotalMinor,
  }));
  const documentPayments: ReceiptPayment[] = detail.payments;
  const documentRefunds: ReceiptRefund[] = detail.refunds.map((refund) => ({
    id: refund.id,
    refundNumber: refund.number,
    totalMinor: refund.totalMinor,
    completedAt: refund.completedAt,
    reason: refund.reason,
    paymentName: null,
    paymentReference: null,
    items: refund.items.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      lineTotalMinor: item.lineTotalMinor,
    })),
  }));
  const refundedQuantityBySaleItem = new Map<string, number>();
  for (const refund of detail.refunds) {
    for (const item of refund.items) {
      refundedQuantityBySaleItem.set(
        item.saleItemId,
        (refundedQuantityBySaleItem.get(item.saleItemId) ?? 0) + item.quantity,
      );
    }
  }
  const canRefund = hasPermission(context, "sales.refund") && hasStoreAccess(context, detail.sale.storeId);
  const canReprint = hasPermission(context, "receipts.reprint");
  const refundPaymentMethods = workspace.paymentMethods
    .filter((method) => method.storeId === detail.sale.storeId)
    .map((method) => ({
      id: method.id,
      name: method.name,
      type: method.type,
      requiresReference: method.requiresReference,
    }));

  return (
    <main className="min-h-svh bg-background">
      <PosWorkspaceHeader
        canAccessBackOffice={canAccessBackOffice(context)}
        canReceiveIncomingTransfers={workspace.canReceiveIncomingTransfers}
        {...getPosNavigationCapabilities(context)}
        canUseTimeClock={context.features.time_clock}
        employeeName={context.profile.full_name || context.profile.email || "Cashier"}
        incomingTransfers={workspace.incomingTransfers}
        organizationName={context.organization.name}
        scope={`${context.organization.id}:${context.user.id}`}
        stores={workspace.stores}
        timeClockEntry={workspace.timeClockEntry}
        timezone={context.organization.timezone}
        title={`Receipt #${detail.receipt.number}`}
      />
      <section className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link className={cn(buttonVariants({ variant: "outline" }))} href="/pos/receipts">
            <ArrowLeft aria-hidden="true" />
            Receipts
          </Link>
          {canReprint ? <ReceiptPrintButton /> : null}
        </div>

        <ReceiptDocument
          cashierName={detail.sale.cashierName}
          currencyCode={detail.sale.currencyCode}
          discountMinor={detail.sale.discountMinor}
          issuedAt={detail.receipt.issuedAt}
          layout={receiptLayout}
          lines={documentLines}
          payments={documentPayments}
          receiptNumber={detail.receipt.number}
          refunds={documentRefunds}
          registerName={detail.sale.registerName}
          subtotalMinor={detail.sale.subtotalMinor}
          taxMinor={detail.sale.taxMinor}
          timezone={context.organization.timezone}
          totalMinor={detail.sale.totalMinor}
        />

        {canRefund ? (
          <RefundForm
            autoFocus={parameters.refund === "1"}
            currencyCode={detail.sale.currencyCode}
            items={detail.items.map((item) => ({
              saleItemId: item.id,
              name: item.name,
              sku: item.sku,
              quantity: item.quantity,
              refundedQuantity: refundedQuantityBySaleItem.get(item.id) ?? 0,
              unit: item.unit,
              unitPriceMinor: item.unitPriceMinor,
            }))}
            originalTotalMinor={detail.sale.totalMinor}
            paymentMethods={refundPaymentMethods}
            receiptNumber={detail.receipt.number}
            receiptId={detail.receipt.id}
            saleId={detail.sale.id}
          />
        ) : (
          <Card>
            <CardContent className="flex gap-3 p-5 text-sm text-muted-foreground">
              <ReceiptText className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <p>Refunds require the existing manager approval and sales.refund permission. Receipt access alone never enables a return.</p>
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
