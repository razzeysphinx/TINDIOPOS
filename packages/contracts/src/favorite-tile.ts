import { z } from "zod";

export const POS_FAVORITE_TILE_PATH = "/api/pos/v2/favorites" as const;
export const POS_FAVORITE_TILE_RPC = "set_pos_favorite_tile" as const;
export const POS_FAVORITE_TILE_PERMISSION = "products.manage" as const;
export const POS_FAVORITE_TILE_MAXIMUM = 24 as const;
export const POS_FAVORITE_TILE_PERMISSION_DATABASE_CODE = "42501" as const;
export const POS_FAVORITE_TILE_INVALID_DATABASE_CODE = "22023" as const;

export const POS_FAVORITE_TILE_PERMISSION_MESSAGE =
  "Product-management permission is required to configure POS tiles." as const;
export const POS_FAVORITE_TILE_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_FAVORITE_TILE_INPUT_MESSAGE =
  "Choose a product in one of your assigned stores." as const;
export const POS_FAVORITE_TILE_RPC_PERMISSION_MESSAGE =
  "You do not have permission to configure tiles for this POS." as const;
export const POS_FAVORITE_TILE_SALEABLE_MESSAGE =
  "Only currently saleable products can be pinned, with up to 24 favorites." as const;
export const POS_FAVORITE_TILE_UPDATE_MESSAGE =
  "TINDIO could not update this POS tile." as const;
export const POS_FAVORITE_TILE_PINNED_MESSAGE =
  "Product pinned to POS favorites." as const;
export const POS_FAVORITE_TILE_REMOVED_MESSAGE =
  "Product removed from POS favorites." as const;

export const favoriteTileSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  isFavorite: z.boolean(),
});

export type PosFavoriteTileUpdate = z.infer<typeof favoriteTileSchema>;

export type PosFavoriteTileActionResult =
  | { ok: true; isFavorite: boolean; message: string }
  | { ok: false; message: string };
