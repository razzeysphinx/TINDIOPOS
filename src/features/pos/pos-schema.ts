import { z } from "zod";

export const favoriteTileSchema = z.object({
  storeId: z.uuid(),
  productId: z.uuid(),
  variantId: z.uuid().nullable(),
  isFavorite: z.boolean(),
});
