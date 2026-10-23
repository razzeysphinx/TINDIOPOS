"use server";

import { revalidatePath } from "next/cache";

import {
  POS_RECEIPT_SETTINGS_DATABASE_MESSAGE,
  POS_RECEIPT_SETTINGS_INPUT_MESSAGE,
  POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE,
  POS_RECEIPT_SETTINGS_RPC,
  POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE,
  receiptSettingsSchema,
} from "@tindio/contracts/receipt-settings";

import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { linkSaleExchange, queueReceiptDelivery } from "@/features/receipts/service";

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
    return { ok: false, message: POS_RECEIPT_SETTINGS_PERMISSION_MESSAGE };
  }

  const parsed = receiptSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: POS_RECEIPT_SETTINGS_INPUT_MESSAGE };
  }

  const supabase = await createClient();
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

  revalidatePath("/back-office/receipt-settings");
  return {
    ok: true,
    message: POS_RECEIPT_SETTINGS_SUCCESS_MESSAGE,
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
  const result = await linkSaleExchange({ context, input });
  if (!result.ok) return result;

  revalidatePath("/back-office/receipts");
  revalidatePath("/back-office/receipts/[receiptId]", "page");
  return result;
}
