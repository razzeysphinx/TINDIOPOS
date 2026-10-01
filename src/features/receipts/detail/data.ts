import "server-only";

import { receiptLayoutFromSnapshot, type ReceiptLayout, type ReceiptPayment, type ReceiptRefund, type ReceiptSaleLine } from "@/features/receipts/receipt-document";
import { loadReceiptDetailBundle } from "@/features/receipts/detail/receipt-detail-read-model";
import { hasPermission, hasStoreAccess, type BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type ReceiptRefundStatus = "completed" | "partially-refunded" | "refunded";
export type ReceiptDetailData = { canRecordExchange: boolean; canRefund: boolean; canReprint: boolean; deliveryRecipientEmail: string | null; deliveries: Array<{ id: string; recipient: string; status: string; createdAt: string }>; documentLines: ReceiptSaleLine[]; documentPayments: ReceiptPayment[]; documentRefunds: ReceiptRefund[]; exchangeReturns: Array<{ id: string; refundNumber: number; totalMinor: number; replacementReceiptNumber: number | null }>; receipt: { id: string; issuedAt: string; number: number }; receiptLayout: ReceiptLayout; refundFormItems: Array<{ refundedQuantity: number; saleItemId: string; name: string; quantity: number; sku: string | null; unit: string; unitPriceMinor: number }>; refundPaymentMethods: Array<{ id: string; name: string; type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER"; requiresReference: boolean }>; refundStatus: ReceiptRefundStatus; sale: { cashierName: string; currencyCode: string; discountMinor: number; id: string; registerName: string; storeId: string; storeName: string; subtotalMinor: number; taxMinor: number; totalMinor: number } };

type Row = Record<string, unknown>;
const string = (row: Row, key: string) => typeof row[key] === "string" ? row[key] : "";
const nullableString = (row: Row, key: string) => typeof row[key] === "string" ? row[key] : null;
const number = (row: Row, key: string) => typeof row[key] === "number" ? row[key] : Number(row[key]) || 0;
const bool = (row: Row, key: string) => row[key] === true;
const receiptItemName = (productName: string, variantName: string | null) => variantName ? `${productName} · ${variantName}` : productName;

export async function loadAuthorizedReceiptDetail(context: BusinessContext, receiptId: string): Promise<ReceiptDetailData | null> {
  const client = await createClient();
  const canReprint = hasPermission(context, "receipts.reprint");
  const mayRefund = hasPermission(context, "sales.refund") || hasPermission(context, "approvals.request");
  const result = await loadReceiptDetailBundle({ client: client as unknown as Parameters<typeof loadReceiptDetailBundle>[0]["client"], organizationId: context.organization.id, receiptId, includeReprintExtensions: canReprint, includeRefundMethods: mayRefund });
  if (result.error) throw new Error(`Unable to load receipt details: ${result.error.message}`);
  const receipt = result.data.receipts[0];
  const sale = result.data.sales[0];
  if (!receipt || !sale || !hasStoreAccess(context, string(sale, "store_id"))) return null;
  const canRefund = mayRefund && hasStoreAccess(context, string(sale, "store_id"));
  const canRecordExchange = canRefund && hasPermission(context, "sales.create");
  const refunds = result.data.refunds;
  const refundItems = result.data.refundItems;
  const refundPayments = result.data.refundPayments;
  const replacementNumbers = new Map(result.data.replacementReceipts.map((item) => [string(item, "sale_id"), number(item, "receipt_number")]));
  const exchanges = new Map(result.data.exchanges.map((item) => [string(item, "refund_id"), nullableString(item, "replacement_sale_id")]).filter((item): item is [string, string] => item[1] !== null));
  const documentLines: ReceiptSaleLine[] = result.data.saleItems.map((item) => ({ id: string(item, "id"), name: receiptItemName(string(item, "product_name_snapshot"), nullableString(item, "variant_name_snapshot")), sku: nullableString(item, "sku_snapshot"), quantity: number(item, "quantity"), unit: string(item, "unit_snapshot"), unitPriceMinor: number(item, "unit_price_minor"), lineTotalMinor: number(item, "line_total_minor") }));
  const documentPayments: ReceiptPayment[] = result.data.payments.map((item) => ({ id: string(item, "id"), name: string(item, "payment_method_name_snapshot"), type: string(item, "payment_method_type_snapshot"), amountMinor: number(item, "amount_minor"), tenderedMinor: number(item, "amount_tendered_minor"), changeMinor: number(item, "change_given_minor"), referenceNumber: nullableString(item, "reference_number") }));
  const documentRefunds: ReceiptRefund[] = refunds.map((refund) => { const payment = refundPayments.find((item) => string(item, "refund_id") === string(refund, "id")); return { id: string(refund, "id"), refundNumber: number(refund, "refund_number"), totalMinor: number(refund, "total_minor"), completedAt: string(refund, "completed_at"), reason: string(refund, "reason"), paymentName: payment ? nullableString(payment, "payment_method_name_snapshot") : null, paymentReference: payment ? nullableString(payment, "reference_number") : null, items: refundItems.filter((item) => string(item, "refund_id") === string(refund, "id")).map((item) => ({ id: string(item, "id"), name: receiptItemName(string(item, "product_name_snapshot"), nullableString(item, "variant_name_snapshot")), quantity: number(item, "quantity"), unit: string(item, "unit_snapshot"), lineTotalMinor: number(item, "line_total_minor"), returnedToStock: bool(item, "returned_to_stock") })) }; });
  const refunded = new Map<string, number>(); for (const item of refundItems) refunded.set(string(item, "sale_item_id"), (refunded.get(string(item, "sale_item_id")) ?? 0) + number(item, "quantity"));
  const refundFormItems = result.data.saleItems.map((item) => ({ saleItemId: string(item, "id"), name: receiptItemName(string(item, "product_name_snapshot"), nullableString(item, "variant_name_snapshot")), sku: nullableString(item, "sku_snapshot"), quantity: number(item, "quantity"), refundedQuantity: refunded.get(string(item, "id")) ?? 0, unit: string(item, "unit_snapshot"), unitPriceMinor: number(item, "unit_price_minor") }));
  const allowedMethods = new Set(result.data.storePaymentMethods.map((item) => string(item, "payment_method_id")));
  const refundPaymentMethods = canRefund ? result.data.paymentMethods.filter((item) => allowedMethods.has(string(item, "id"))).map((item) => ({ id: string(item, "id"), name: string(item, "name"), type: string(item, "payment_type") as ReceiptDetailData["refundPaymentMethods"][number]["type"], requiresReference: bool(item, "requires_reference") })) : [];
  const hasRefunds = documentRefunds.length > 0;
  const fullyRefunded = hasRefunds && refundFormItems.every((item) => item.quantity <= item.refundedQuantity);
  return { canRecordExchange, canRefund, canReprint, deliveryRecipientEmail: nullableString(result.data.customerEmails[0] ?? {}, "email"), deliveries: result.data.deliveries.map((item) => ({ id: string(item, "id"), recipient: string(item, "recipient"), status: string(item, "status"), createdAt: string(item, "created_at") })), documentLines, documentPayments, documentRefunds, exchangeReturns: refunds.map((refund) => ({ id: string(refund, "id"), refundNumber: number(refund, "refund_number"), totalMinor: number(refund, "total_minor"), replacementReceiptNumber: replacementNumbers.get(exchanges.get(string(refund, "id")) ?? "") ?? null })), receipt: { id: string(receipt, "id"), issuedAt: string(receipt, "issued_at"), number: number(receipt, "receipt_number") }, receiptLayout: receiptLayoutFromSnapshot(receipt.receipt_layout_snapshot, { organizationName: string(sale, "organization_name_snapshot"), storeName: string(sale, "store_name_snapshot") }), refundFormItems, refundPaymentMethods, refundStatus: fullyRefunded ? "refunded" : hasRefunds ? "partially-refunded" : "completed", sale: { cashierName: string(sale, "cashier_name_snapshot"), currencyCode: string(sale, "currency_code"), discountMinor: number(sale, "discount_minor"), id: string(sale, "id"), registerName: string(sale, "register_name_snapshot"), storeId: string(sale, "store_id"), storeName: string(sale, "store_name_snapshot"), subtotalMinor: number(sale, "subtotal_minor"), taxMinor: number(sale, "tax_minor"), totalMinor: number(sale, "total_minor") } };
}
