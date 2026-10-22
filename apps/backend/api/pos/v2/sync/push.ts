import { randomUUID } from "node:crypto";

import { createOwnedSyncPushDependencies } from "../../../../src/pos/sync-push-runtime.js";
import { serveSyncPush } from "../../../../src/pos/sync-push-service.js";

export async function POST(request: Request): Promise<Response> {
  return serveSyncPush(request, {
    mode: process.env.TINDIO_SYNC_PUSH_MODE,
    upstreamOrigin: process.env.TINDIO_WEB_API_ORIGIN,
    createRequestId: randomUUID,
    createOwnedDependencies: () => createOwnedSyncPushDependencies({
      environment: {
        SUPABASE_URL: process.env.SUPABASE_URL,
        SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
        NEON_DATA_API_URL: process.env.NEON_DATA_API_URL,
      },
    }),
  });
}
