import { randomUUID } from "node:crypto";

import { createOwnedRefundDependencies } from "../../../../../src/pos/refund-runtime.js";
import { serveRefund } from "../../../../../src/pos/refund-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveRefund(request, {
    mode: process.env.TINDIO_REFUND_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedRefundDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
