import { randomUUID } from "node:crypto";

import { createOwnedReceiptAdministrationDependencies } from "../../../src/pos/receipt-administration-runtime.js";
import { serveReceiptAdministration } from "../../../src/pos/receipt-administration-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveReceiptAdministration(request, {
    action: "settings",
    mode: process.env.TINDIO_RECEIPT_SETTINGS_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedReceiptAdministrationDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
