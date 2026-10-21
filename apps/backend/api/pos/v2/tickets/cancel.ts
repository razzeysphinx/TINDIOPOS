import { randomUUID } from "node:crypto";

import { createOwnedOpenTicketCancelDependencies } from "../../../../src/pos/open-ticket-cancel-runtime.js";
import { serveOpenTicketCancel } from "../../../../src/pos/open-ticket-cancel-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveOpenTicketCancel(request, {
    mode: process.env.TINDIO_OPEN_TICKET_CANCEL_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedOpenTicketCancelDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
