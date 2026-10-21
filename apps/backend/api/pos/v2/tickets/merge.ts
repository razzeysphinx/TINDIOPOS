import { randomUUID } from "node:crypto";

import { createOwnedOpenTicketMergeDependencies } from "../../../../src/pos/open-ticket-merge-runtime.js";
import { serveOpenTicketMerge } from "../../../../src/pos/open-ticket-merge-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveOpenTicketMerge(request, {
    mode: process.env.TINDIO_OPEN_TICKET_MERGE_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedOpenTicketMergeDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
