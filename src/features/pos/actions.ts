"use server";

import { loadPosReceiptDetail, type PosReceiptDetail } from "@/features/pos/data";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { z } from "zod";

const receiptIdSchema = z.object({ receiptId: z.uuid() });

export async function loadPosReceiptQuickViewAction(input: unknown): Promise<
  | { ok: true; data: PosReceiptDetail }
  | { ok: false; message: string }
> {
  const parsed = receiptIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "We couldn't load this receipt." };

  try {
    const context = await requireBusinessContext();
    if (!hasPermission(context, "pos.access") || !hasPermission(context, "sales.create") || !hasPermission(context, "receipts.view")) {
      return { ok: false, message: "We couldn't load this receipt." };
    }
    const detail = await loadPosReceiptDetail(context, parsed.data.receiptId);
    return detail ? { ok: true, data: detail } : { ok: false, message: "We couldn't load this receipt." };
  } catch {
    return { ok: false, message: "We couldn't load this receipt." };
  }
}
