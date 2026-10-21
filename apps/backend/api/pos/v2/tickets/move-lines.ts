import { randomUUID } from "node:crypto";

import { createOwnedOpenTicketMoveLinesDependencies } from "../../../../src/pos/open-ticket-move-lines-runtime.js";
import { serveOpenTicketMoveLines } from "../../../../src/pos/open-ticket-move-lines-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveOpenTicketMoveLines(request, {
    mode: process.env.TINDIO_OPEN_TICKET_MOVE_LINES_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedOpenTicketMoveLinesDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
