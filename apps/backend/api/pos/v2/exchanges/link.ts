import { randomUUID } from "node:crypto";

import { createOwnedSaleExchangeDependencies } from "../../../../src/pos/sale-exchange-runtime.js";
import { serveSaleExchange } from "../../../../src/pos/sale-exchange-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveSaleExchange(request, {
    mode: process.env.TINDIO_SALE_EXCHANGE_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedSaleExchangeDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
