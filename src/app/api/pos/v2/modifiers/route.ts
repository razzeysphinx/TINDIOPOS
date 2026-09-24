import {
  randomUUID,
} from "node:crypto";

import type {
  NextRequest,
} from "next/server";

import type {
  PosModifiersV2Response,
} from "@/contracts/pos";
import {
  posApiJson,
} from "@/features/pos/pos-api-response";
import {
  getPosV2Modifiers,
} from "@/lib/auth/pos-v2-catalog";

export async function GET(
  request: NextRequest,
) {
  const requestId =
    randomUUID();
  const result =
    await getPosV2Modifiers(request);

  if (!result.ok) {
    const response =
      posApiJson(
        {
          ok: false,
          reason: result.reason,
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

  const body: PosModifiersV2Response = {
    ...result.modifiers,
    version: 2,
    requestId,
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
