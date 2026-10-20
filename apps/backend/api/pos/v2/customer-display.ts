import { randomUUID } from "node:crypto";

import { createOwnedCustomerDisplayDependencies } from "../../../src/pos/customer-display-runtime.js";
import { serveCustomerDisplayUpdate } from "../../../src/pos/customer-display-service.js";

export async function PUT(request: Request): Promise<Response> {
  return serveCustomerDisplayUpdate(request, {
    mode: process.env.TINDIO_CUSTOMER_DISPLAY_UPDATE_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedCustomerDisplayDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
