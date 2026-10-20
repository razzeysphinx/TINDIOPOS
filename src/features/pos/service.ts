import "server-only";

import {
  POS_FAVORITE_TILE_INPUT_MESSAGE,
  POS_FAVORITE_TILE_INVALID_DATABASE_CODE,
  POS_FAVORITE_TILE_PINNED_MESSAGE,
  POS_FAVORITE_TILE_REMOVED_MESSAGE,
  POS_FAVORITE_TILE_RPC,
  POS_FAVORITE_TILE_RPC_PERMISSION_MESSAGE,
  POS_FAVORITE_TILE_PERMISSION_DATABASE_CODE,
  POS_FAVORITE_TILE_SALEABLE_MESSAGE,
  POS_FAVORITE_TILE_UPDATE_MESSAGE,
  favoriteTileSchema,
  type PosFavoriteTileActionResult,
} from "@tindio/contracts/favorite-tile";
import type { BusinessContext } from "@/lib/auth/dal";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export async function setPosFavoriteTile({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<PosFavoriteTileActionResult> {
  const parsed = favoriteTileSchema.safeParse(input);
  if (!parsed.success || !context.storeIds.includes(parsed.data.storeId)) {
    return { ok: false, message: POS_FAVORITE_TILE_INPUT_MESSAGE };
  }

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_FAVORITE_TILE_RPC, {
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
        error?.code === POS_FAVORITE_TILE_PERMISSION_DATABASE_CODE
          ? POS_FAVORITE_TILE_RPC_PERMISSION_MESSAGE
          : error?.code === POS_FAVORITE_TILE_INVALID_DATABASE_CODE
            ? POS_FAVORITE_TILE_SALEABLE_MESSAGE
            : POS_FAVORITE_TILE_UPDATE_MESSAGE,
    };
  }

  return {
    ok: true,
    isFavorite: data,
    message: data ? POS_FAVORITE_TILE_PINNED_MESSAGE : POS_FAVORITE_TILE_REMOVED_MESSAGE,
  };
}
