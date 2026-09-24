import "server-only";

import {
  z,
} from "zod";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createPosV2DatabaseClient,
} from "@/lib/supabase/pos-v2-database-client";

export const POS_V2_ORGANIZATION_HEADER =
  "x-tindio-organization-id";

const uuidSchema =
  z.uuid();

const MAX_TOKEN_LENGTH =
  16_384;

export type PosV2CoreResult =
  | {
      ok: true;
      core: Record<string, unknown>;
    }
  | {
      ok: false;
      status: 401 | 403 | 503;
      reason: string;
    };

function bearerFromRequest(
  request: Request,
) {
  const authorization =
    request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const match =
    /^Bearer ([^\s]+)$/i.exec(
      authorization.trim(),
    );

  const token =
    match?.[1];

  if (
    !token
    || token.length > MAX_TOKEN_LENGTH
    || token.split(".").length !== 3
  ) {
    return null;
  }

  return token;
}

function authErrorStatus(
  error: unknown,
) {
  if (
    error
    && typeof error === "object"
    && "status" in error
    && (
      error.status === 401
      || error.status === 403
    )
  ) {
    return 401 as const;
  }

  return 503 as const;
}

export async function getPosV2Core(
  request: Request,
): Promise<PosV2CoreResult> {
  const token =
    bearerFromRequest(request);

  if (!token) {
    return {
      ok: false,
      status: 401,
      reason: "AUTH_REQUIRED",
    };
  }

  const authClient =
    await createClient();

  let claimsResult;

  try {
    claimsResult =
      await authClient.auth.getClaims(
        token,
      );
  } catch (error) {
    return {
      ok: false,
      status:
        authErrorStatus(error),
      reason:
        "AUTH_PROVIDER_UNAVAILABLE",
    };
  }

  if (
    claimsResult.error
    || !claimsResult.data?.claims
  ) {
    return {
      ok: false,
      status:
        authErrorStatus(
          claimsResult.error,
        ),
      reason:
        claimsResult.error
          ? "AUTH_INVALID_OR_UNAVAILABLE"
          : "AUTH_INVALID",
    };
  }

  const requestedHeader =
    request.headers.get(
      POS_V2_ORGANIZATION_HEADER,
    );

  const parsedOrganization =
    requestedHeader
      ? uuidSchema.safeParse(
          requestedHeader,
        )
      : null;

  if (
    parsedOrganization
    && !parsedOrganization.success
  ) {
    return {
      ok: false,
      status: 403,
      reason:
        "ORGANIZATION_FORBIDDEN",
    };
  }

  const database =
    createPosV2DatabaseClient(
      token,
    );

  let rpcResult;

  try {
    rpcResult =
      await database.rpc(
        "get_pos_bootstrap_core_v2",
        parsedOrganization?.success
          ? {
              target_organization_id:
                parsedOrganization.data,
            }
          : {},
      );
  } catch {
    return {
      ok: false,
      status: 503,
      reason:
        "DATABASE_UNAVAILABLE",
    };
  }

  if (rpcResult.error) {
    return {
      ok: false,
      status: 503,
      reason:
        "DATABASE_UNAVAILABLE",
    };
  }

  const payload =
    rpcResult.data;

  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
  ) {
    return {
      ok: false,
      status: 503,
      reason:
        "INVALID_CORE_RESPONSE",
    };
  }

  const record =
    payload as Record<string, unknown>;

  if (record.ok !== true) {
    const reason =
      typeof record.reason === "string"
        ? record.reason
        : "POS_CONTEXT_UNAVAILABLE";

    return {
      ok: false,
      status:
        reason === "IDENTITY_UNMAPPED"
          ? 401
          : 403,
      reason,
    };
  }

  return {
    ok: true,
    core: record,
  };
}
