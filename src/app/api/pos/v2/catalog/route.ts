import {
  randomUUID,
} from "node:crypto";

import type {
  NextRequest,
} from "next/server";

import type {
  PosCatalogV2Response,
} from "@/contracts/pos";
import {
  posApiJson,
} from "@/features/pos/pos-api-response";
import {
  getPosV2Catalog,
} from "@/lib/auth/pos-v2-catalog";

export async function GET(
  request: NextRequest,
) {
  const requestId =
    randomUUID();
  const result =
    await getPosV2Catalog(request);

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

  const body: PosCatalogV2Response = {
    ...result.catalog,
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
