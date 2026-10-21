import { randomUUID } from "node:crypto";

import { createOwnedOpenTicketSplitDependencies } from "../../../../src/pos/open-ticket-split-runtime.js";
import { serveOpenTicketSplit } from "../../../../src/pos/open-ticket-split-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveOpenTicketSplit(request, {
    mode: process.env.TINDIO_OPEN_TICKET_SPLIT_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedOpenTicketSplitDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
