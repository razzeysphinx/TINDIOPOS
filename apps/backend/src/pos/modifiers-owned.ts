import type {
  PosModifierGroup,
  PosModifierOption,
  PosModifiersV2Response,
} from "@tindio/contracts/cart";

import { POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ModifiersQuery = {
  store: string;
  product: string;
};

export type ModifiersClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

export type ModifiersRpcResult = {
  data: unknown;
  error: unknown;
};

export type OwnedModifiersDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<ModifiersClaimsResult>;
  loadModifiers: (
    token: string,
    organizationId: string,
    query: ModifiersQuery,
  ) => Promise<ModifiersRpcResult>;
};

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  requestId: string,
): Response {
  const response = Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
  response.headers.set("x-tindio-request-id", requestId);
  return response;
}

function failure(
  status: 400 | 401 | 403 | 503,
  reason: string,
  requestId: string,
): Response {
  return jsonResponse({ ok: false, reason, requestId }, status, requestId);
}

function bearerFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;

  const token = /^Bearer ([^\s]+)$/i.exec(authorization.trim())?.[1];
  return token
    && token.length <= MAX_TOKEN_LENGTH
    && token.split(".").length === 3
      ? token
      : null;
}

function authErrorStatus(error: unknown): 401 | 503 {
  if (error instanceof SyntaxError) return 401;

  const status = error
    && typeof error === "object"
    && "status" in error
    && typeof error.status === "number"
      ? error.status
      : null;

  return status !== null && status >= 400 && status < 500 && status !== 429
    ? 401
    : 503;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function isModifierOption(value: unknown): value is PosModifierOption {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isNumber(value.priceMinor);
}

function isModifierGroup(value: unknown): value is PosModifierGroup {
  return isRecord(value)
    && isString(value.id)
    && isString(value.name)
    && isNumber(value.minSelections)
    && isNumber(value.maxSelections)
    && Array.isArray(value.options)
    && value.options.every(isModifierOption);
}

function parseQuery(request: Request): ModifiersQuery | null {
  const parameters = new URL(request.url).searchParams;
  const store = parameters.get("store");
  const product = parameters.get("product");

  return store
    && product
    && UUID_PATTERN.test(store)
    && UUID_PATTERN.test(product)
      ? { store, product }
      : null;
}

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

export async function handleOwnedPosModifiers(
  request: Request,
  dependencies: OwnedModifiersDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const query = parseQuery(request);

  if (!query) return failure(400, "MODIFIER_QUERY_INVALID", requestId);

  const token = bearerFromRequest(request);
  if (!token) return failure(401, "AUTH_REQUIRED", requestId);

  let claimsResult: ModifiersClaimsResult;

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

  const organizationId = request.headers.get(POS_V2_ORGANIZATION_HEADER);
  if (!organizationId || !UUID_PATTERN.test(organizationId)) {
    return failure(403, "ORGANIZATION_FORBIDDEN", requestId);
  }

  let rpcResult: ModifiersRpcResult;

  try {
    rpcResult = await dependencies.loadModifiers(token, organizationId, query);
    if (!rpcResult.error && isIdentityUnmapped(rpcResult.data)) {
      rpcResult = await dependencies.loadModifiers(token, organizationId, query);
    }
  } catch {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  if (rpcResult.error) return failure(503, "DATABASE_UNAVAILABLE", requestId);

  const payload = rpcResult.data;
  if (!isRecord(payload)) {
    return failure(503, "INVALID_MODIFIERS_RESPONSE", requestId);
  }

  if (payload.ok !== true) {
    const reason = isString(payload.reason)
      ? payload.reason
      : "POS_CONTEXT_UNAVAILABLE";
    const status = reason === "IDENTITY_UNMAPPED"
      ? 401
      : reason === "CATALOG_MODE_INVALID" || reason === "CATALOG_PAGE_INVALID"
        ? 400
        : 403;
    return failure(status, reason, requestId);
  }

  if (
    !isString(payload.organizationId)
    || !isString(payload.storeId)
    || !isString(payload.productId)
    || !Array.isArray(payload.groups)
    || !payload.groups.every(isModifierGroup)
  ) {
    return failure(503, "INVALID_MODIFIERS_RESPONSE", requestId);
  }

  const body: PosModifiersV2Response = {
    ok: true,
    version: 2,
    requestId,
    organizationId: payload.organizationId,
    storeId: payload.storeId,
    productId: payload.productId,
    groups: payload.groups,
  };

  return jsonResponse(body, 200, requestId);
}
