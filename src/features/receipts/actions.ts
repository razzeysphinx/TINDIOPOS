"use server";

import { revalidatePath } from "next/cache";

import { refundSale, type RefundSaleActionResult } from "@/features/receipts/service";
import { requireBusinessContext } from "@/lib/auth/dal";

export type { RefundSaleActionResult } from "@/features/receipts/service";

export async function refundSaleAction(input: unknown): Promise<RefundSaleActionResult> {
  const context = await requireBusinessContext();
  const result = await refundSale({ context, input });
  if (!result.ok) return result;

  revalidatePath("/back-office/receipts");
  revalidatePath("/back-office/receipts/[receiptId]", "page");
  revalidatePath("/back-office/inventory");
  revalidatePath("/pos/receipts");
  revalidatePath("/pos/receipts/[receiptId]", "page");

  return result;
}
