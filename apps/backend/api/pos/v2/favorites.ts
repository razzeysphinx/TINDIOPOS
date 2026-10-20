import { randomUUID } from "node:crypto";

import { createOwnedFavoriteTileDependencies } from "../../../src/pos/favorite-tile-runtime.js";
import { serveFavoriteTileUpdate } from "../../../src/pos/favorite-tile-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveFavoriteTileUpdate(request, {
    mode: process.env.TINDIO_FAVORITE_TILE_UPDATE_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedFavoriteTileDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
