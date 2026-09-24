import {
  randomUUID,
} from "node:crypto";

import type {
  PosLiveV2Response,
} from "@/contracts/pos";
import {
  posApiJson,
} from "@/features/pos/pos-api-response";
import {
  getPosV2Live,
} from "@/lib/auth/pos-v2-live";

export async function GET(
  request: Request,
) {
  const requestId =
    randomUUID();

  const result =
    await getPosV2Live(request);

  if (!result.ok) {
    const response =
      posApiJson(
        {
          ok: false,
          reason:
            result.reason,
          requestId,
        },
        result.status,
      );

    response.headers.set(
      "x-tindio-request-id",
      requestId,
    );
    response.headers.set(
      "Cache-Control",
      "no-store",
    );

    return response;
  }

  const body: PosLiveV2Response = {
    ok: true,
    version: 2,
    requestId,
    organizationId:
      result.organizationId,
    storeId: result.storeId,
    registerId:
      result.registerId,
    live: result.live,
  };

  const response =
    posApiJson(body);

  response.headers.set(
    "x-tindio-request-id",
    requestId,
  );
  response.headers.set(
    "Cache-Control",
    "no-store",
  );

  return response;
}
