import { randomUUID } from "node:crypto";

import { createOwnedModifiersDependencies } from "../../../src/pos/modifiers-runtime.js";
import { servePosModifiers } from "../../../src/pos/modifiers-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosModifiers(request, {
    mode: process.env.TINDIO_MODIFIERS_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedModifiersDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
