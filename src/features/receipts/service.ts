import "server-only";

import {
  POS_RECEIPT_DELIVERY_CHANNEL,
  POS_RECEIPT_DELIVERY_DATABASE_MESSAGE,
  POS_RECEIPT_DELIVERY_INPUT_MESSAGE,
  POS_RECEIPT_DELIVERY_PERMISSION_MESSAGE,
  POS_RECEIPT_DELIVERY_RPC,
  receiptDeliverySchema,
  receiptDeliverySuccessMessage,
  type ReceiptDeliveryResult,
} from "@tindio/contracts/receipt-delivery";
import {
  POS_RECEIPT_SETTINGS_DATABASE_MESSAGE,
  POS_RECEIPT_SETTINGS_INPUT_MESSAGE,
  POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE,
  POS_RECEIPT_SETTINGS_RPC,
  POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE,
  receiptSettingsSchema,
  type ReceiptSettingsResult,
} from "@tindio/contracts/receipt-settings";
import {
  POS_REFUND_DATABASE_MESSAGE,
  POS_REFUND_DATABASE_PERMISSION_MESSAGE,
  POS_REFUND_IDEMPOTENCY_MESSAGE,
  POS_REFUND_INCOMPLETE_MESSAGE,
  POS_REFUND_INPUT_MESSAGE,
  POS_REFUND_PERMISSION_MESSAGE,
  refundSaleSchema,
  type RefundSaleResult,
  type RefundSaleValues,
} from "@tindio/contracts/refund";
import {
  POS_SALE_EXCHANGE_DATABASE_MESSAGE,
  POS_SALE_EXCHANGE_INPUT_MESSAGE,
  POS_SALE_EXCHANGE_PERMISSION_MESSAGE,
  POS_SALE_EXCHANGE_RPC,
  saleExchangeSchema,
  saleExchangeSuccessMessage,
  type SaleExchangeResult,
} from "@tindio/contracts/sale-exchange";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export type RefundSaleActionResult = RefundSaleResult;

export type ReceiptImprovementActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function updateReceiptSettings({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<ReceiptSettingsResult> {
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE };
  }
  const parsed = receiptSettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: POS_RECEIPT_SETTINGS_INPUT_MESSAGE };

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_RECEIPT_SETTINGS_RPC, {
    target_organization_id: context.organization.id,
    target_business_name: parsed.data.businessName,
    target_business_address: parsed.data.businessAddress,
    target_business_phone: parsed.data.businessPhone,
    target_business_email: parsed.data.businessEmail,
    target_business_tax_id: parsed.data.businessTaxId,
    target_business_website: parsed.data.businessWebsite,
    target_header_message: parsed.data.headerMessage,
    target_footer_message: parsed.data.footerMessage,
    target_paper_width_mm: parsed.data.paperWidthMm,
    target_show_store_address: parsed.data.showStoreAddress,
    target_show_store_phone: parsed.data.showStorePhone,
    target_show_cashier: parsed.data.showCashier,
    target_show_register: parsed.data.showRegister,
    target_show_payment_details: parsed.data.showPaymentDetails,
  });
  if (error || !data) {
    return {
      ok: false,
      message: receiptDatabaseMessage(
        error?.code,
        error?.message,
        POS_RECEIPT_SETTINGS_DATABASE_MESSAGE,
      ),
    };
  }
  return { ok: true, message: POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE };
}

export async function linkSaleExchange({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<SaleExchangeResult> {
  if (!hasPermission(context, "sales.refund") || !hasPermission(context, "sales.create")) {
    return { ok: false, message: POS_SALE_EXCHANGE_PERMISSION_MESSAGE };
  }

  const parsed = saleExchangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: POS_SALE_EXCHANGE_INPUT_MESSAGE };

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_SALE_EXCHANGE_RPC, {
    target_organization_id: context.organization.id,
    target_refund_id: parsed.data.refundId,
    target_replacement_receipt_number: parsed.data.replacementReceiptNumber,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  const result = data?.[0];
  if (error || !result) {
    return {
      ok: false,
      message: receiptDatabaseMessage(
        error?.code,
        error?.message,
        POS_SALE_EXCHANGE_DATABASE_MESSAGE,
      ),
    };
  }
  return { ok: true, message: saleExchangeSuccessMessage(result) };
}

function refundDatabaseMessage(code: string | undefined, message: string | undefined) {
  if (code === "42501") return POS_REFUND_DATABASE_PERMISSION_MESSAGE;
  if (code === "23505") return POS_REFUND_IDEMPOTENCY_MESSAGE;
  if (code === "23514" && message) return message;
  if (code === "40001") return POS_REFUND_INCOMPLETE_MESSAGE;
  return POS_REFUND_DATABASE_MESSAGE;
}

function receiptDatabaseMessage(
  code: string | null | undefined,
  message: string | null | undefined,
  fallback: string,
) {
  if (code === "42501") return "You do not have permission to perform this receipt action.";
  if (code === "23505") return message ?? "This action was already recorded for a different request.";
  if ((code === "23514" || code === "P0002") && message) return message;
  return fallback;
}

export async function refundSale({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<RefundSaleActionResult> {
  const parsed = refundSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: POS_REFUND_INPUT_MESSAGE };
  }
  if (!hasPermission(context, "sales.refund") && !parsed.data.approvalRequestId) {
    return { ok: false, message: POS_REFUND_PERMISSION_MESSAGE };
  }

  const data = parsed.data satisfies RefundSaleValues;
  const supabase = await createBusinessContextClient(context);
  const { data: refund, error } = await supabase.rpc("refund_sale", {
    target_organization_id: context.organization.id,
    target_sale_id: data.saleId,
    target_payment_method_id: data.paymentMethodId,
    target_idempotency_key: data.idempotencyKey,
    target_reason: data.reason,
    target_reference_number: (data.referenceNumber || null) as never,
    target_items: data.items.map((item) => ({
      sale_item_id: item.saleItemId,
      quantity: item.quantity,
      return_to_stock: item.returnToStock,
    })) as Json,
    ...(data.approvalRequestId ? { target_approval_request_id: data.approvalRequestId } : {}),
  });

  const result = refund?.[0];
  if (error || !result) return { ok: false, message: refundDatabaseMessage(error?.code, error?.message) };
  return {
    ok: true,
    message: result.was_replayed
      ? `Refund #${result.refund_number} was already completed.`
      : `Refund #${result.refund_number} was completed.`,
    data: {
      refundId: result.refund_id,
      refundNumber: result.refund_number,
      totalMinor: result.total_minor,
      wasReplayed: result.was_replayed,
    },
  };
}

export async function queueReceiptDelivery({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<ReceiptDeliveryResult> {
  if (!hasPermission(context, "receipts.reprint")) {
    return { ok: false, message: POS_RECEIPT_DELIVERY_PERMISSION_MESSAGE };
  }
  const parsed = receiptDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: POS_RECEIPT_DELIVERY_INPUT_MESSAGE };

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_RECEIPT_DELIVERY_RPC, {
    target_organization_id: context.organization.id,
    target_receipt_id: parsed.data.receiptId,
    target_delivery_channel: POS_RECEIPT_DELIVERY_CHANNEL,
    target_recipient: parsed.data.recipient,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  const result = data?.[0];
  if (error || !result) {
    return { ok: false, message: receiptDatabaseMessage(error?.code, error?.message, POS_RECEIPT_DELIVERY_DATABASE_MESSAGE) };
  }
  return { ok: true, message: receiptDeliverySuccessMessage(result) };
}
