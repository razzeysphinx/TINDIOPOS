import { randomUUID } from "node:crypto";

import { createOwnedOfflineCheckoutDependencies } from "../../../src/pos/offline-checkout-runtime.js";
import { serveOfflineCheckout } from "../../../src/pos/offline-checkout-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveOfflineCheckout(request, {
    mode: process.env.TINDIO_OFFLINE_CHECKOUT_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedOfflineCheckoutDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
