import "server-only";

import {
  z,
} from "zod";

import {
  createClient,
} from "@/lib/supabase/server";

import {
  createPosV2DatabaseClient,
  retryPosV2IdentityUnmapped,
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
      auth: {
        token: string;
        authorizationHeader: string;
        subject: string;
        email: string | null;
      };
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
  if (error instanceof SyntaxError) {
    return 401 as const;
  }

  const message =
    error instanceof Error
      ? error.message
      : "";

  if (
    /(?:invalid|malformed)[\s\S]*(?:token|jwt|jws|utf-8|signature)|expired[\s\S]*(?:token|jwt|jws)/i
      .test(message)
  ) {
    return 401 as const;
  }

  const status =
    error
    && typeof error === "object"
    && "status" in error
    && typeof error.status === "number"
      ? error.status
      : null;

  if (
    status !== null
    && status >= 400
    && status < 500
    && status !== 429
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
    const status =
      authErrorStatus(error);

    return {
      ok: false,
      status,
      reason:
        status === 401
          ? "AUTH_INVALID"
          : "AUTH_PROVIDER_UNAVAILABLE",
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

  const claims =
    claimsResult.data.claims as Record<string, unknown>;
  const subject =
    typeof claims.sub === "string"
    && claims.sub.length > 0
      ? claims.sub
      : null;

  if (!subject) {
    return {
      ok: false,
      status: 401,
      reason: "AUTH_INVALID",
    };
  }

  const email =
    typeof claims.email === "string"
      ? claims.email
      : null;

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
      await retryPosV2IdentityUnmapped(
        () => database.rpc(
          "get_pos_bootstrap_core_v2",
          parsedOrganization?.success
            ? {
                target_organization_id:
                  parsedOrganization.data,
              }
            : {},
        ),
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
    auth: {
      token,
      authorizationHeader:
        `Bearer ${token}`,
      subject,
      email,
    },
  };
}
