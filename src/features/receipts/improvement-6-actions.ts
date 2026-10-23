"use server";

import { revalidatePath } from "next/cache";

import { requireBusinessContext } from "@/lib/auth/dal";
import { linkSaleExchange, queueReceiptDelivery, updateReceiptSettings } from "@/features/receipts/service";

export type ReceiptImprovementActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export async function updateReceiptSettingsAction(
  input: unknown,
): Promise<ReceiptImprovementActionResult> {
  const context = await requireBusinessContext();
  const result = await updateReceiptSettings({ context, input });
  if (!result.ok) return result;

  revalidatePath("/back-office/receipt-settings");
  return result;
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
