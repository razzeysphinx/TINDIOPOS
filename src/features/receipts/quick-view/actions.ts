"use server";

import { z } from "zod";

import { loadAuthorizedReceiptDetail } from "@/features/receipts/detail/data";
import { requireBackOfficePermission } from "@/lib/auth/dal";

const receiptIdSchema = z.object({ receiptId: z.uuid() });

export type ReceiptQuickViewActionResult =
  | { ok: true; data: Awaited<ReturnType<typeof loadAuthorizedReceiptDetail>> }
  | { ok: false; message: string };

export async function loadReceiptQuickViewAction(input: unknown): Promise<ReceiptQuickViewActionResult> {
  const parsed = receiptIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "We couldn't load this receipt." };

  try {
    const context = await requireBackOfficePermission("receipts.view");
    const data = await loadAuthorizedReceiptDetail(context, parsed.data.receiptId);
    return data
      ? { ok: true, data }
      : { ok: false, message: "We couldn't load this receipt." };
  } catch {
    return { ok: false, message: "We couldn't load this receipt." };
  }
}
