export const POS_V2_ORGANIZATION_HEADER = "x-tindio-organization-id";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BootstrapClaimsResult = {
  data?: {
    claims?: Record<string, unknown>;
  } | null;
  error?: unknown;
};

export type BootstrapCoreResult = {
  data: unknown;
  error: unknown;
};

export type OwnedBootstrapDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<BootstrapClaimsResult>;
  loadCore: (
    token: string,
    organizationId: string | null,
  ) => Promise<BootstrapCoreResult>;
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): Response {
  const response = Response.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
    },
  });

  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

function failure(
  status: 401 | 403 | 503,
  reason: string,
  requestId: string,
): Response {
  return jsonResponse(
    {
      ok: false,
      reason,
      requestId,
    },
    status,
    requestId,
  );
}

function bearerFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization.trim());
  const token = match?.[1];

  if (
    !token
    || token.length > MAX_TOKEN_LENGTH
    || token.split(".").length !== 3
  ) {
    return null;
  }

  return token;
}

export function authErrorStatus(error: unknown): 401 | 503 {
  if (error instanceof SyntaxError) {
    return 401;
  }

  const message = error instanceof Error ? error.message : "";

  if (
    /(?:invalid|malformed)[\s\S]*(?:token|jwt|jws|utf-8|signature)|expired[\s\S]*(?:token|jwt|jws)/i
      .test(message)
  ) {
    return 401;
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
    return 401;
  }

  return 503;
}

function isIdentityUnmapped(payload: unknown): boolean {
  return Boolean(
    payload
    && typeof payload === "object"
    && !Array.isArray(payload)
    && "reason" in payload
    && payload.reason === "IDENTITY_UNMAPPED",
  );
}

export async function handleOwnedPosBootstrap(
  request: Request,
  dependencies: OwnedBootstrapDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);

  if (!token) {
    return failure(401, "AUTH_REQUIRED", requestId);
  }

  let claimsResult: BootstrapClaimsResult;

  try {
    claimsResult = await dependencies.verifyClaims(token);
  } catch (error) {
    const status = authErrorStatus(error);

    return failure(
      status,
      status === 401 ? "AUTH_INVALID" : "AUTH_PROVIDER_UNAVAILABLE",
      requestId,
    );
  }

  if (claimsResult.error || !claimsResult.data?.claims) {
    return failure(
      authErrorStatus(claimsResult.error),
      claimsResult.error ? "AUTH_INVALID_OR_UNAVAILABLE" : "AUTH_INVALID",
      requestId,
    );
  }

  const subject = claimsResult.data.claims.sub;

  if (typeof subject !== "string" || subject.length === 0) {
    return failure(401, "AUTH_INVALID", requestId);
  }

  const requestedHeader = request.headers.get(
    POS_V2_ORGANIZATION_HEADER,
  );
  const requestedOrganization = requestedHeader || null;

  if (
    requestedOrganization
    && !UUID_PATTERN.test(requestedOrganization)
  ) {
    return failure(403, "ORGANIZATION_FORBIDDEN", requestId);
  }

  let coreResult: BootstrapCoreResult;

  try {
    coreResult = await dependencies.loadCore(
      token,
      requestedOrganization,
    );

    if (!coreResult.error && isIdentityUnmapped(coreResult.data)) {
      coreResult = await dependencies.loadCore(
        token,
        requestedOrganization,
      );
    }
  } catch {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  if (coreResult.error) {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  const payload = coreResult.data;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return failure(503, "INVALID_CORE_RESPONSE", requestId);
  }

  const core = payload as Record<string, unknown>;

  if (core.ok !== true) {
    const reason =
      typeof core.reason === "string"
        ? core.reason
        : "POS_CONTEXT_UNAVAILABLE";

    return failure(
      reason === "IDENTITY_UNMAPPED" ? 401 : 403,
      reason,
      requestId,
    );
  }

  const permissions = Array.isArray(core.permissions)
    ? core.permissions.filter(
        (permission): permission is string => typeof permission === "string",
      )
    : [];

  if (
    !permissions.includes("pos.access")
    || !permissions.includes("sales.create")
  ) {
    return failure(403, "POS_ACCESS_FORBIDDEN", requestId);
  }

  return jsonResponse(
    {
      ok: true,
      version: 2,
      requestId,
      core,
    },
    200,
    requestId,
  );
}
