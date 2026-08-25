"use server";

import { revalidatePath } from "next/cache";

import { setPosFavoriteTile } from "@/features/pos/service";
import type { PosFavoriteTileActionResult } from "@/features/pos/pos-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export async function setPosFavoriteTileAction(
  input: unknown,
): Promise<PosFavoriteTileActionResult> {
  const context = await requireBusinessContext();

  if (!hasPermission(context, "products.manage")) {
    return {
      ok: false,
      message: "Product-management permission is required to configure POS tiles.",
    };
  }

  const result = await setPosFavoriteTile({ context, input });
  if (result.ok) {
    revalidatePath("/pos");
  }

  return result;
}
