import {
  POS_FAVORITE_TILE_INPUT_MESSAGE,
  POS_FAVORITE_TILE_INVALID_DATABASE_CODE,
  POS_FAVORITE_TILE_MAXIMUM,
  POS_FAVORITE_TILE_PATH,
  POS_FAVORITE_TILE_PERMISSION,
  POS_FAVORITE_TILE_PERMISSION_DATABASE_CODE,
  POS_FAVORITE_TILE_PERMISSION_MESSAGE,
  POS_FAVORITE_TILE_PINNED_MESSAGE,
  POS_FAVORITE_TILE_REMOVED_MESSAGE,
  POS_FAVORITE_TILE_REQUEST_INVALID_MESSAGE,
  POS_FAVORITE_TILE_RPC,
  POS_FAVORITE_TILE_RPC_PERMISSION_MESSAGE,
  POS_FAVORITE_TILE_SALEABLE_MESSAGE,
  POS_FAVORITE_TILE_UPDATE_MESSAGE,
  favoriteTileSchema,
  type PosFavoriteTileActionResult,
  type PosFavoriteTileUpdate,
} from "@tindio/contracts/favorite-tile";

export const FAVORITE_TILE_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_FAVORITE_TILE_PATH,
  permission: POS_FAVORITE_TILE_PERMISSION,
  rpc: POS_FAVORITE_TILE_RPC,
  rpcArguments: [
    "target_organization_id",
    "target_store_id",
    "target_product_id",
    "target_variant_id",
    "target_is_favorite",
  ],
  maximumTiles: POS_FAVORITE_TILE_MAXIMUM,
  actionResponse: {
    status: 200,
    headers: { "cache-control": "private, no-store" },
  },
  malformedJsonResponse: {
    status: 400,
    headers: { "cache-control": "private, no-store" },
    body: { ok: false, message: POS_FAVORITE_TILE_REQUEST_INVALID_MESSAGE },
  },
} as const;

export type FavoriteTileValidation =
  | { ok: true; update: PosFavoriteTileUpdate }
  | { ok: false; result: PosFavoriteTileActionResult };

export function validateFavoriteTileUpdate(
  value: unknown,
  assignedStoreIds: readonly string[],
): FavoriteTileValidation {
  const parsed = favoriteTileSchema.safeParse(value);
  return parsed.success && assignedStoreIds.includes(parsed.data.storeId)
    ? { ok: true, update: parsed.data }
    : {
        ok: false,
        result: { ok: false, message: POS_FAVORITE_TILE_INPUT_MESSAGE },
      };
}

export function favoriteTilePermissionFailure(): PosFavoriteTileActionResult {
  return { ok: false, message: POS_FAVORITE_TILE_PERMISSION_MESSAGE };
}

export function mapFavoriteTileRpcResult(
  data: unknown,
  error: { code?: string | null } | null,
  requestedFavoriteState: boolean,
): PosFavoriteTileActionResult {
  if (error || data !== requestedFavoriteState) {
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
    isFavorite: requestedFavoriteState,
    message: requestedFavoriteState
      ? POS_FAVORITE_TILE_PINNED_MESSAGE
      : POS_FAVORITE_TILE_REMOVED_MESSAGE,
  };
}
