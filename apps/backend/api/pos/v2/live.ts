import { randomUUID } from "node:crypto";

import { createOwnedLiveDependencies } from "../../../src/pos/live-runtime.js";
import { servePosLive } from "../../../src/pos/live-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosLive(request, {
    mode: process.env.TINDIO_LIVE_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedLiveDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
