"use server";

import { revalidatePath } from "next/cache";

import {
  receiptSettingsSchema,
  saleExchangeSchema,
} from "@/features/receipts/improvement-6-schema";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { queueReceiptDelivery } from "@/features/receipts/service";

export type ReceiptImprovementActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

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

export async function updateReceiptSettingsAction(
  input: unknown,
): Promise<ReceiptImprovementActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to update receipt settings." };
  }

  const parsed = receiptSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Check the receipt business information and layout values." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_receipt_settings", {
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
        "TINDIO could not save the receipt settings.",
      ),
    };
  }

  revalidatePath("/back-office/receipt-settings");
  return {
    ok: true,
    message: "Receipt settings saved. New receipts will preserve this layout; existing receipts stay unchanged.",
  };
}

export async function queueReceiptDeliveryAction(
  input: unknown,
): Promise<ReceiptImprovementActionResult> {
  const context = await requireBusinessContext();
  const result = await queueReceiptDelivery({ context, input });
  if (!result.ok) return result;

  revalidatePath("/back-office/receipts");
  const receiptId = (input as { receiptId?: unknown }).receiptId;
  if (typeof receiptId === "string") revalidatePath(`/back-office/receipts/${receiptId}`);
  return result;
}

export async function linkSaleExchangeAction(
  input: unknown,
): Promise<ReceiptImprovementActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "sales.refund") || !hasPermission(context, "sales.create")) {
    return { ok: false, message: "Sales and refund permission are required to record an exchange." };
  }

  const parsed = saleExchangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a completed return and enter a valid replacement receipt number." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_sale_exchange", {
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
        "TINDIO could not link this return and replacement sale.",
      ),
    };
  }

  revalidatePath("/back-office/receipts");
  revalidatePath("/back-office/receipts/[receiptId]", "page");
  return {
    ok: true,
    message: result.was_replayed
      ? `This exchange is already linked to receipt #${result.replacement_receipt_number}.`
      : `Exchange recorded: return linked to replacement receipt #${result.replacement_receipt_number}.`,
  };
}
