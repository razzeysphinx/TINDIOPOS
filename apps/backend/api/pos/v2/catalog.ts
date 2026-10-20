import { randomUUID } from "node:crypto";

import { createOwnedCatalogDependencies } from "../../../src/pos/catalog-runtime.js";
import { servePosCatalog } from "../../../src/pos/catalog-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosCatalog(request, {
    mode: process.env.TINDIO_CATALOG_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedCatalogDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
