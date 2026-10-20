import type {
  PosCatalogItem,
  PosCatalogV2Response,
} from "@tindio/contracts/pos-data";

import { POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATALOG_MODES = new Set(["search", "favorites", "recent"]);

type CatalogMode = PosCatalogV2Response["mode"];
type CatalogQuery = {
  store: string;
  mode: CatalogMode;
  query: string;
  category?: string;
  offset: number;
  limit: number;
};

export type CatalogClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

export type CatalogRpcResult = {
  data: unknown;
  error: unknown;
};

export type OwnedCatalogDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<CatalogClaimsResult>;
  loadCatalog: (
    token: string,
    organizationId: string,
    query: CatalogQuery,
  ) => Promise<CatalogRpcResult>;
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
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

function isCatalogItem(value: unknown): value is PosCatalogItem {
  return isRecord(value)
    && isString(value.productId)
    && isNullableString(value.variantId)
    && isNullableString(value.categoryId)
    && isString(value.productName)
    && isNullableString(value.variantName)
    && isNullableString(value.sku)
    && isNullableString(value.barcode)
    && isNumber(value.priceMinor)
    && isString(value.unit)
    && isNullableString(value.imageUrl)
    && isBoolean(value.isVariablePrice)
    && isBoolean(value.allowFractionalQuantity)
    && (!("hasModifiers" in value) || isBoolean(value.hasModifiers));
}

function optionalInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  if (value === null) return fallback;

  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : null;
}

function parseQuery(request: Request): CatalogQuery | null {
  const parameters = new URL(request.url).searchParams;
  const store = parameters.get("store");
  const mode = parameters.get("mode") ?? "search";
  const query = (parameters.get("query") ?? "").trim();
  const category = parameters.get("category");
  const offset = optionalInteger(parameters.get("offset"), 0, 0, 10_000);
  const limit = optionalInteger(parameters.get("limit"), 24, 1, 24);

  if (
    !store
    || !UUID_PATTERN.test(store)
    || !CATALOG_MODES.has(mode)
    || query.length > 100
    || (category !== null && !UUID_PATTERN.test(category))
    || offset === null
    || limit === null
  ) {
    return null;
  }

  return {
    store,
    mode: mode as CatalogMode,
    query,
    ...(category === null ? {} : { category }),
    offset,
    limit,
  };
}

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

export async function handleOwnedPosCatalog(
  request: Request,
  dependencies: OwnedCatalogDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const query = parseQuery(request);

  if (!query) return failure(400, "CATALOG_QUERY_INVALID", requestId);

  const token = bearerFromRequest(request);
  if (!token) return failure(401, "AUTH_REQUIRED", requestId);

  let claimsResult: CatalogClaimsResult;

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

  let rpcResult: CatalogRpcResult;

  try {
    rpcResult = await dependencies.loadCatalog(token, organizationId, query);
    if (!rpcResult.error && isIdentityUnmapped(rpcResult.data)) {
      rpcResult = await dependencies.loadCatalog(token, organizationId, query);
    }
  } catch {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  if (rpcResult.error) return failure(503, "DATABASE_UNAVAILABLE", requestId);

  const payload = rpcResult.data;
  if (!isRecord(payload)) {
    return failure(503, "INVALID_CATALOG_RESPONSE", requestId);
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
    || !isString(payload.mode)
    || !CATALOG_MODES.has(payload.mode)
    || !isNumber(payload.offset)
    || !isNumber(payload.limit)
    || !Array.isArray(payload.items)
    || !payload.items.every(isCatalogItem)
    || !isBoolean(payload.hasMore)
  ) {
    return failure(503, "INVALID_CATALOG_RESPONSE", requestId);
  }

  const body: PosCatalogV2Response = {
    ok: true,
    version: 2,
    requestId,
    organizationId: payload.organizationId,
    storeId: payload.storeId,
    mode: payload.mode as CatalogMode,
    offset: payload.offset,
    limit: payload.limit,
    items: payload.items,
    hasMore: payload.hasMore,
  };

  return jsonResponse(body, 200, requestId);
}
