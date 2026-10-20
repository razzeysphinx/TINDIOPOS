import { randomUUID } from "node:crypto";

import { createOwnedCustomersDependencies } from "../../../src/pos/customers-runtime.js";
import { servePosCustomers } from "../../../src/pos/customers-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosCustomers(request, {
    mode: process.env.TINDIO_CUSTOMERS_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedCustomersDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
