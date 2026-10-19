import { randomUUID } from "node:crypto";

import { proxyPosBootstrap } from "../../../src/pos/bootstrap-proxy.js";

export async function GET(
  request: Request,
): Promise<Response> {
  return proxyPosBootstrap(
    request,
    {
      upstreamOrigin:
        process.env.TINDIO_WEB_API_ORIGIN,
      createRequestId: randomUUID,
    },
  );
}
