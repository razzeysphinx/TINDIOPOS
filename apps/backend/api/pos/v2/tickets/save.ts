import { randomUUID } from "node:crypto";

import { createOwnedOpenTicketSaveDependencies } from "../../../../src/pos/open-ticket-save-runtime.js";
import { serveOpenTicketSave } from "../../../../src/pos/open-ticket-save-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveOpenTicketSave(request, {
    mode: process.env.TINDIO_OPEN_TICKET_SAVE_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedOpenTicketSaveDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
