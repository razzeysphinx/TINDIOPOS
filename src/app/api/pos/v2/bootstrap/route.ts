import {
  randomUUID,
} from "node:crypto";

import {
  posApiJson,
} from "@/features/pos/pos-api-response";

import {
  getPosV2Core,
} from "@/lib/auth/pos-v2-context";

export async function GET(
  request: Request,
) {
  const requestId =
    randomUUID();

  const result =
    await getPosV2Core(request);

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

  const permissions =
    Array.isArray(
      result.core.permissions,
    )
      ? result.core.permissions.filter(
          (
            permission,
          ): permission is string =>
            typeof permission === "string",
        )
      : [];

  if (
    !permissions.includes("pos.access")
    || !permissions.includes("sales.create")
  ) {
    const response =
      posApiJson(
        {
          ok: false,
          reason:
            "POS_ACCESS_FORBIDDEN",
          requestId,
        },
        403,
      );

    response.headers.set(
      "x-tindio-request-id",
      requestId,
    );

    return response;
  }

  const response =
    posApiJson({
      ok: true,
      version: 2,
      requestId,
      core:
        result.core,
    });

  response.headers.set(
    "x-tindio-request-id",
    requestId,
  );

  return response;
}
