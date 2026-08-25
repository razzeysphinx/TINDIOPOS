"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const favoriteTileSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  isFavorite: z.boolean(),
});

export type PosFavoriteTileActionResult =
  | { ok: true; isFavorite: boolean; message: string }
  | { ok: false; message: string };

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

  const parsed = favoriteTileSchema.safeParse(input);
  if (!parsed.success || !context.storeIds.includes(parsed.data.storeId)) {
    return { ok: false, message: "Choose a product in one of your assigned stores." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_pos_favorite_tile", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_product_id: parsed.data.productId,
    // Nullable PostgreSQL RPC arguments are generated as strings by the local
    // schema generator, even though this routine explicitly accepts null.
    target_variant_id: (parsed.data.variantId ?? null) as never,
    target_is_favorite: parsed.data.isFavorite,
  });

  if (error || data !== parsed.data.isFavorite) {
    return {
      ok: false,
      message:
        error?.code === "42501"
          ? "You do not have permission to configure tiles for this POS."
          : error?.code === "22023"
            ? "Only currently saleable products can be pinned, with up to 24 favorites."
            : "TINDIO could not update this POS tile.",
    };
  }

  revalidatePath("/pos");
  return {
    ok: true,
    isFavorite: data,
    message: data ? "Product pinned to POS favorites." : "Product removed from POS favorites.",
  };
}
