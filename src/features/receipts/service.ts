import "server-only";

import { receiptDeliverySchema } from "@/features/receipts/improvement-6-schema";
import { refundSaleSchema, type RefundSaleValues } from "@/features/receipts/refund-schema";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import type { Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

export type RefundSaleActionResult =
  | {
      ok: true;
      message: string;
      data: {
        refundId: string;
        refundNumber: number;
        totalMinor: number;
        wasReplayed: boolean;
      };
    }
  | { ok: false; message: string };

export type ReceiptImprovementActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function refundDatabaseMessage(code: string | undefined, message: string | undefined) {
  if (code === "42501") return "You do not have permission to process refunds for this sale.";
  if (code === "23505") return "This refund key belongs to a different request. Start a new refund.";
  if (code === "23514" && message) return message;
  if (code === "40001") return "The prior refund did not finish. Try again with a new refund.";
  return "TINDIO could not process this refund. No payment record or stock change was made.";
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
    return { ok: false, message: "Check the selected quantities, refund method, and reason before continuing." };
  }
  if (!hasPermission(context, "sales.refund") && !parsed.data.approvalRequestId) {
    return { ok: false, message: "You do not have permission to process refunds." };
  }

  const data = parsed.data satisfies RefundSaleValues;
  const supabase = await createClient();
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

  const supabase = await createClient();
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
