import {
  randomUUID,
} from "node:crypto";

import type {
  PosReferenceV2Response,
} from "@/contracts/pos-v1";
import {
  posApiJson,
} from "@/features/pos/pos-api-response";
import {
  getPosV2Reference,
} from "@/lib/auth/pos-v2-reference";

export async function GET(
  request: Request,
) {
  const requestId =
    randomUUID();

  const result =
    await getPosV2Reference(request);

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

    return response;
  }

  const body: PosReferenceV2Response = {
    ok: true,
    version: 2,
    requestId,
    organizationId:
      result.organizationId,
    referenceVersion:
      result.referenceVersion,
    reference:
      result.reference,
  };

  const response =
    posApiJson(body);

  response.headers.set(
    "x-tindio-request-id",
    requestId,
  );
  response.headers.set(
    "x-tindio-reference-version",
    result.referenceVersion,
  );
  response.headers.set(
    "ETag",
    `\"${result.referenceVersion}\"`,
  );

  return response;
}
