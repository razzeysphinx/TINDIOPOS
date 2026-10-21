import { randomUUID } from "node:crypto";

import { createOwnedCheckoutDependencies } from "../../../src/pos/checkout-runtime.js";
import { serveCheckout } from "../../../src/pos/checkout-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveCheckout(request, {
    mode: process.env.TINDIO_CHECKOUT_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedCheckoutDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
