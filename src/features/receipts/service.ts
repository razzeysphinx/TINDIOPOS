import "server-only";

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
import { receiptDeliverySchema } from "@/features/receipts/improvement-6-schema";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export type RefundSaleActionResult = RefundSaleResult;

export type ReceiptImprovementActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

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
}): Promise<ReceiptImprovementActionResult> {
  if (!hasPermission(context, "receipts.reprint")) {
    return { ok: false, message: "You do not have permission to queue a digital receipt." };
  }
  const parsed = receiptDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid recipient email address." };

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc("queue_receipt_delivery", {
    target_organization_id: context.organization.id,
    target_receipt_id: parsed.data.receiptId,
    target_delivery_channel: "EMAIL",
    target_recipient: parsed.data.recipient,
    target_idempotency_key: parsed.data.idempotencyKey,
  });
  const result = data?.[0];
  if (error || !result) {
    return { ok: false, message: receiptDatabaseMessage(error?.code, error?.message, "TINDIO could not queue this digital receipt.") };
  }
  return {
    ok: true,
    message: result.was_replayed
      ? "This digital receipt request was already queued."
      : "Digital receipt request queued securely.",
  };
}
