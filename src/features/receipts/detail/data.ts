import "server-only";

import {
  receiptLayoutFromSnapshot,
  type ReceiptLayout,
  type ReceiptPayment,
  type ReceiptRefund,
  type ReceiptSaleLine,
} from "@/features/receipts/receipt-document";
import { hasPermission, hasStoreAccess, type BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type ReceiptRefundStatus = "completed" | "partially-refunded" | "refunded";

export type ReceiptDetailData = {
  canRecordExchange: boolean;
  canRefund: boolean;
  canReprint: boolean;
  deliveryRecipientEmail: string | null;
  deliveries: Array<{ id: string; recipient: string; status: string; createdAt: string }>;
  documentLines: ReceiptSaleLine[];
  documentPayments: ReceiptPayment[];
  documentRefunds: ReceiptRefund[];
  exchangeReturns: Array<{
    id: string;
    refundNumber: number;
    totalMinor: number;
    replacementReceiptNumber: number | null;
  }>;
  receipt: {
    id: string;
    issuedAt: string;
    number: number;
  };
  receiptLayout: ReceiptLayout;
  refundFormItems: Array<{
    refundedQuantity: number;
    saleItemId: string;
    name: string;
    quantity: number;
    sku: string | null;
    unit: string;
    unitPriceMinor: number;
  }>;
  refundPaymentMethods: Array<{
    id: string;
    name: string;
    type: "CASH" | "CARD" | "E_WALLET" | "BANK_TRANSFER" | "VOUCHER" | "OTHER";
    requiresReference: boolean;
  }>;
  refundStatus: ReceiptRefundStatus;
  sale: {
    cashierName: string;
    currencyCode: string;
    discountMinor: number;
    id: string;
    registerName: string;
    storeId: string;
    storeName: string;
    subtotalMinor: number;
    taxMinor: number;
    totalMinor: number;
  };
};

function receiptItemName(productName: string, variantName: string | null) {
  return variantName ? `${productName} · ${variantName}` : productName;
}

/**
 * The single canonical Back Office receipt read model. It deliberately uses
 * the authenticated Supabase client and organization/store capability checks;
 * callers only choose how much of this immutable data they render.
 */
export async function loadAuthorizedReceiptDetail(
  context: BusinessContext,
  receiptId: string,
): Promise<ReceiptDetailData | null> {
  const supabase = await createClient();
  const { data: receipt, error: receiptError } = await supabase
    .from("receipts")
    .select("id, sale_id, receipt_number, issued_at, receipt_layout_snapshot")
    .eq("id", receiptId)
    .eq("organization_id", context.organization.id)
    .maybeSingle();

  if (receiptError) throw new Error(`Unable to load receipt: ${receiptError.message}`);
  if (!receipt) return null;

  const [saleResult, saleItemsResult, paymentsResult, refundsResult] = await Promise.all([
    supabase
      .from("sales")
      .select(
        "id, store_id, customer_id, currency_code, organization_name_snapshot, store_name_snapshot, register_name_snapshot, cashier_name_snapshot, subtotal_minor, discount_minor, tax_minor, total_minor",
      )
      .eq("id", receipt.sale_id)
      .eq("organization_id", context.organization.id)
      .maybeSingle(),
    supabase
      .from("sale_items")
      .select(
        "id, product_name_snapshot, variant_name_snapshot, sku_snapshot, unit_snapshot, quantity, unit_price_minor, line_total_minor",
      )
      .eq("sale_id", receipt.sale_id)
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("payments")
      .select(
        "id, payment_method_name_snapshot, payment_method_type_snapshot, amount_minor, amount_tendered_minor, change_given_minor, reference_number",
      )
      .eq("sale_id", receipt.sale_id)
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("refunds")
      .select("id, refund_number, total_minor, completed_at, reason")
      .eq("sale_id", receipt.sale_id)
      .eq("organization_id", context.organization.id)
      .order("completed_at", { ascending: false }),
  ]);

  const baseError = [saleResult, saleItemsResult, paymentsResult, refundsResult].find(
    (result) => result.error,
  )?.error;
  if (baseError) throw new Error(`Unable to load receipt details: ${baseError.message}`);
  if (!saleResult.data) return null;

  const sale = saleResult.data;
  if (!hasStoreAccess(context, sale.store_id)) return null;
  const refunds = refundsResult.data ?? [];
  const refundIds = refunds.map((refund) => refund.id);
  const [refundItemsResult, refundPaymentsResult, exchangesResult] = refundIds.length > 0
    ? await Promise.all([
        supabase
          .from("refund_items")
          .select("id, refund_id, sale_item_id, product_name_snapshot, variant_name_snapshot, quantity, unit_snapshot, line_total_minor, returned_to_stock")
          .eq("organization_id", context.organization.id)
          .in("refund_id", refundIds)
          .order("created_at", { ascending: true }),
        supabase
          .from("refund_payments")
          .select("refund_id, payment_method_name_snapshot, reference_number")
          .eq("organization_id", context.organization.id)
          .in("refund_id", refundIds),
        supabase
          .from("sale_exchanges")
          .select("id, refund_id, replacement_sale_id, created_at")
          .eq("organization_id", context.organization.id)
          .in("refund_id", refundIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];

  if (refundItemsResult.error || refundPaymentsResult.error || exchangesResult.error) {
    throw new Error(
      `Unable to load refund details: ${refundItemsResult.error?.message ?? refundPaymentsResult.error?.message ?? exchangesResult.error?.message}`,
    );
  }

  // A restricted employee can prepare the exact same request through the
  // established manager-approval path. The RPC still verifies the approval,
  // employee, organization, and store scope before it posts a refund.
  const canRefund = (
    hasPermission(context, "sales.refund") || hasPermission(context, "approvals.request")
  ) && hasStoreAccess(context, sale.store_id);
  const canReprint = hasPermission(context, "receipts.reprint");
  const canRecordExchange = canRefund && hasPermission(context, "sales.create");
  const exchanges = exchangesResult.data ?? [];
  const replacementSaleIds = exchanges.map((exchange) => exchange.replacement_sale_id);
  const [replacementReceiptsResult, deliveriesResult, customerEmailResult] = await Promise.all([
    replacementSaleIds.length > 0
      ? supabase
          .from("receipts")
          .select("sale_id, receipt_number")
          .eq("organization_id", context.organization.id)
          .in("sale_id", replacementSaleIds)
      : Promise.resolve({ data: [], error: null }),
    canReprint
      ? supabase
          .from("receipt_delivery_requests")
          .select("id, recipient, status, created_at")
          .eq("organization_id", context.organization.id)
          .eq("receipt_id", receipt.id)
          .order("created_at", { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    canReprint && sale.customer_id
      ? supabase
          .from("customers")
          .select("email")
          .eq("id", sale.customer_id)
          .eq("organization_id", context.organization.id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (replacementReceiptsResult.error || deliveriesResult.error || customerEmailResult.error) {
    throw new Error(
      `Unable to load receipt extensions: ${replacementReceiptsResult.error?.message ?? deliveriesResult.error?.message ?? customerEmailResult.error?.message}`,
    );
  }

  const replacementReceiptNumberBySaleId = new Map(
    (replacementReceiptsResult.data ?? []).map((replacementReceipt) => [
      replacementReceipt.sale_id,
      replacementReceipt.receipt_number,
    ]),
  );
  let refundPaymentMethods: ReceiptDetailData["refundPaymentMethods"] = [];

  if (canRefund) {
    const [methodsResult, availabilityResult] = await Promise.all([
      supabase
        .from("payment_methods")
        .select("id, name, payment_type, requires_reference")
        .eq("organization_id", context.organization.id)
        .eq("is_enabled", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("store_payment_methods")
        .select("payment_method_id")
        .eq("organization_id", context.organization.id)
        .eq("store_id", sale.store_id)
        .eq("is_enabled", true),
    ]);

    if (methodsResult.error || availabilityResult.error) {
      throw new Error(
        `Unable to load refund payment methods: ${methodsResult.error?.message ?? availabilityResult.error?.message}`,
      );
    }

    const enabledMethodIds = new Set(
      (availabilityResult.data ?? []).map((availability) => availability.payment_method_id),
    );
    refundPaymentMethods = (methodsResult.data ?? [])
      .filter((method) => enabledMethodIds.has(method.id))
      .map((method) => ({
        id: method.id,
        name: method.name,
        type: method.payment_type as ReceiptDetailData["refundPaymentMethods"][number]["type"],
        requiresReference: method.requires_reference,
      }));
  }

  const documentLines: ReceiptSaleLine[] = (saleItemsResult.data ?? []).map((item) => ({
    id: item.id,
    name: receiptItemName(item.product_name_snapshot, item.variant_name_snapshot),
    sku: item.sku_snapshot,
    quantity: item.quantity,
    unit: item.unit_snapshot,
    unitPriceMinor: item.unit_price_minor,
    lineTotalMinor: item.line_total_minor,
  }));
  const documentPayments: ReceiptPayment[] = (paymentsResult.data ?? []).map((payment) => ({
    id: payment.id,
    name: payment.payment_method_name_snapshot,
    type: payment.payment_method_type_snapshot,
    amountMinor: payment.amount_minor,
    tenderedMinor: payment.amount_tendered_minor,
    changeMinor: payment.change_given_minor,
    referenceNumber: payment.reference_number,
  }));
  const refundItems = refundItemsResult.data ?? [];
  const refundPayments = refundPaymentsResult.data ?? [];
  const documentRefunds: ReceiptRefund[] = refunds.map((refund) => {
    const payment = refundPayments.find((candidate) => candidate.refund_id === refund.id);
    return {
      id: refund.id,
      refundNumber: refund.refund_number,
      totalMinor: refund.total_minor,
      completedAt: refund.completed_at,
      reason: refund.reason,
      paymentName: payment?.payment_method_name_snapshot ?? null,
      paymentReference: payment?.reference_number ?? null,
      items: refundItems
        .filter((item) => item.refund_id === refund.id)
        .map((item) => ({
          id: item.id,
          name: receiptItemName(item.product_name_snapshot, item.variant_name_snapshot),
          quantity: item.quantity,
          unit: item.unit_snapshot,
          lineTotalMinor: item.line_total_minor,
          returnedToStock: item.returned_to_stock,
        })),
    };
  });
  const refundQuantityBySaleItem = new Map<string, number>();
  for (const item of refundItems) {
    refundQuantityBySaleItem.set(
      item.sale_item_id,
      (refundQuantityBySaleItem.get(item.sale_item_id) ?? 0) + item.quantity,
    );
  }
  const receiptLayout = receiptLayoutFromSnapshot(receipt.receipt_layout_snapshot, {
    organizationName: sale.organization_name_snapshot,
    storeName: sale.store_name_snapshot,
  });
  const exchangeByRefundId = new Map(
    exchanges.map((exchange) => [
      exchange.refund_id,
      replacementReceiptNumberBySaleId.get(exchange.replacement_sale_id) ?? null,
    ]),
  );
  const refundFormItems = (saleItemsResult.data ?? []).map((item) => ({
    saleItemId: item.id,
    name: receiptItemName(item.product_name_snapshot, item.variant_name_snapshot),
    sku: item.sku_snapshot,
    quantity: item.quantity,
    refundedQuantity: refundQuantityBySaleItem.get(item.id) ?? 0,
    unit: item.unit_snapshot,
    unitPriceMinor: item.unit_price_minor,
  }));
  const hasRefunds = documentRefunds.length > 0;
  const fullyRefunded = hasRefunds && refundFormItems.every((item) => item.quantity <= item.refundedQuantity);

  return {
    canRecordExchange,
    canRefund,
    canReprint,
    deliveryRecipientEmail: customerEmailResult.data?.email ?? null,
    deliveries: (deliveriesResult.data ?? []).map((delivery) => ({
      id: delivery.id,
      recipient: delivery.recipient,
      status: delivery.status,
      createdAt: delivery.created_at,
    })),
    documentLines,
    documentPayments,
    documentRefunds,
    exchangeReturns: refunds.map((refund) => ({
      id: refund.id,
      refundNumber: refund.refund_number,
      totalMinor: refund.total_minor,
      replacementReceiptNumber: exchangeByRefundId.get(refund.id) ?? null,
    })),
    receipt: { id: receipt.id, issuedAt: receipt.issued_at, number: receipt.receipt_number },
    receiptLayout,
    refundFormItems,
    refundPaymentMethods,
    refundStatus: fullyRefunded ? "refunded" : hasRefunds ? "partially-refunded" : "completed",
    sale: {
      cashierName: sale.cashier_name_snapshot,
      currencyCode: sale.currency_code,
      discountMinor: sale.discount_minor,
      id: sale.id,
      registerName: sale.register_name_snapshot,
      storeId: sale.store_id,
      storeName: sale.store_name_snapshot,
      subtotalMinor: sale.subtotal_minor,
      taxMinor: sale.tax_minor,
      totalMinor: sale.total_minor,
    },
  };
}
