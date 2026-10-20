"use server";

import { revalidatePath } from "next/cache";

import {
  POS_FAVORITE_TILE_PERMISSION,
  POS_FAVORITE_TILE_PERMISSION_MESSAGE,
  type PosFavoriteTileActionResult,
} from "@tindio/contracts/favorite-tile";

import { setPosFavoriteTile } from "@/features/pos/service";
import { loadPosReceiptDetail, type PosReceiptDetail } from "@/features/pos/data";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { z } from "zod";

export async function setPosFavoriteTileAction(
  input: unknown,
): Promise<PosFavoriteTileActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, POS_FAVORITE_TILE_PERMISSION)) {
    return {
      ok: false,
      message: POS_FAVORITE_TILE_PERMISSION_MESSAGE,
    };
  }

  const result = await setPosFavoriteTile({ context, input });
  if (result.ok) {
    revalidatePath("/pos");
  }

  return result;
}

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
