import { randomUUID } from "node:crypto";

import { createOwnedReceiptsDependencies } from "../../../src/pos/receipts-runtime.js";
import { servePosReceipts } from "../../../src/pos/receipts-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosReceipts(request, {
    mode: process.env.TINDIO_RECEIPTS_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedReceiptsDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
