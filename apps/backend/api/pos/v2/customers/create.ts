import { randomUUID } from "node:crypto";

import { createOwnedCustomerCreationDependencies } from "../../../../src/pos/customer-creation-runtime.js";
import { serveCustomerCreation } from "../../../../src/pos/customer-creation-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveCustomerCreation(request, {
    mode: process.env.TINDIO_CUSTOMER_CREATION_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedCustomerCreationDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
