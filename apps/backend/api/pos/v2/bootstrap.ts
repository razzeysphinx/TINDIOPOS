import { randomUUID } from "node:crypto";

import { createOwnedBootstrapDependencies } from "../../../src/pos/bootstrap-runtime.js";
import { servePosBootstrap } from "../../../src/pos/bootstrap-service.js";

export async function GET(
  request: Request,
): Promise<Response> {
  return servePosBootstrap(
    request,
    {
      mode:
        process.env.TINDIO_BOOTSTRAP_READ_MODE,
      upstreamOrigin:
        process.env.TINDIO_WEB_API_ORIGIN,
      createRequestId: randomUUID,
      createOwnedDependencies: () =>
        createOwnedBootstrapDependencies({
          environment: {
            SUPABASE_URL:
              process.env.SUPABASE_URL,
            SUPABASE_PUBLISHABLE_KEY:
              process.env.SUPABASE_PUBLISHABLE_KEY,
            NEON_DATA_API_URL:
              process.env.NEON_DATA_API_URL,
          },
          createRequestId: randomUUID,
        }),
    },
  );
}
