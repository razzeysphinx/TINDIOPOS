import { randomUUID } from "node:crypto";

import { createOwnedTransferReceiptDependencies } from "../../../../../src/pos/transfer-receipt-runtime.js";
import { serveTransferReceipt } from "../../../../../src/pos/transfer-receipt-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveTransferReceipt(request, {
    mode: process.env.TINDIO_TRANSFER_RECEIPT_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedTransferReceiptDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
