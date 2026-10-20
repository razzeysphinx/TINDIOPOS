import { randomUUID } from "node:crypto";

import { createOwnedReferenceDependencies } from "../../../src/pos/reference-runtime.js";
import { servePosReference } from "../../../src/pos/reference-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosReference(request, {
    mode: process.env.TINDIO_REFERENCE_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedReferenceDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
