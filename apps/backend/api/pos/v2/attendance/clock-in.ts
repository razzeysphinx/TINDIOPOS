import { randomUUID } from "node:crypto";

import { createOwnedAttendanceMutationDependencies } from "../../../../src/pos/attendance-mutation-runtime.js";
import { serveAttendanceMutation } from "../../../../src/pos/attendance-mutation-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveAttendanceMutation(request, "clock-in", {
    mode: process.env.TINDIO_ATTENDANCE_MUTATION_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedAttendanceMutationDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
