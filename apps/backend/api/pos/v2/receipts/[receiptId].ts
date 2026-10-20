import { randomUUID } from "node:crypto";

import { createOwnedReceiptDetailDependencies } from "../../../../src/pos/receipt-detail-runtime.js";
import { servePosReceiptDetail } from "../../../../src/pos/receipt-detail-service.js";

export async function GET(request: Request): Promise<Response> {
  return servePosReceiptDetail(request, {
    mode: process.env.TINDIO_RECEIPT_DETAIL_READ_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedReceiptDetailDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
      createRequestId: randomUUID,
    }),
  });
}
