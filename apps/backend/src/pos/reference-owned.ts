import type { PosReferenceV2Response } from "@tindio/contracts/pos-data";

import { POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReferenceBundle = PosReferenceV2Response["reference"];

export type ReferenceClaimsResult = {
  data?: {
    claims?: Record<string, unknown>;
  } | null;
  error?: unknown;
};

export type ReferenceRpcResult = {
  data: unknown;
  error: unknown;
};

export type OwnedReferenceDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<ReferenceClaimsResult>;
  loadReference: (
    token: string,
    organizationId: string | null,
  ) => Promise<ReferenceRpcResult>;
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

function authErrorStatus(error: unknown): 401 | 503 {
  if (error instanceof SyntaxError) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

function hasEveryValue(
  value: unknown,
  predicate: (entry: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.every(predicate);
}

function isReferenceBundle(value: unknown): value is ReferenceBundle {
  return isRecord(value)
    && hasEveryValue(
      value.categories,
      (entry) => isRecord(entry)
        && isString(entry.id)
        && isString(entry.name)
        && isNullableString(entry.color),
    )
    && hasEveryValue(
      value.paymentMethods,
      (entry) => isRecord(entry)
        && isString(entry.id)
        && isString(entry.storeId)
        && isString(entry.name)
        && isString(entry.code)
        && isString(entry.type)
        && ["CASH", "CARD", "E_WALLET", "BANK_TRANSFER", "VOUCHER", "OTHER"]
          .includes(entry.type)
        && isString(entry.offlinePolicy)
        && ["disabled", "cash", "manual_external"].includes(entry.offlinePolicy)
        && isBoolean(entry.requiresReference)
        && isNumber(entry.sortOrder),
    )
    && (
      value.loyaltyProgram === null
      || (
        isRecord(value.loyaltyProgram)
        && isBoolean(value.loyaltyProgram.isEnabled)
        && isNumber(value.loyaltyProgram.earnSpendMinor)
        && isNumber(value.loyaltyProgram.earnPoints)
        && isNumber(value.loyaltyProgram.redemptionValueMinor)
        && isNumber(value.loyaltyProgram.minimumRedemptionPoints)
      )
    )
    && hasEveryValue(
      value.discounts,
      (entry) => isRecord(entry)
        && isString(entry.id)
        && isString(entry.name)
        && isString(entry.discountType)
        && ["percentage", "fixed_amount"].includes(entry.discountType)
        && (entry.percentageBps === null || isNumber(entry.percentageBps))
        && (entry.amountMinor === null || isNumber(entry.amountMinor)),
    )
    && hasEveryValue(
      value.taxRates,
      (entry) => isRecord(entry)
        && isString(entry.id)
        && isString(entry.name)
        && isNumber(entry.rateBps)
        && isBoolean(entry.isInclusive)
        && isBoolean(entry.isDefault),
    )
    && hasEveryValue(
      value.diningOptions,
      (entry) => isRecord(entry)
        && isString(entry.id)
        && isString(entry.name)
        && isBoolean(entry.isDefault),
    )
    && hasEveryValue(
      value.ticketTemplates,
      (entry) => isRecord(entry)
        && isString(entry.id)
        && isString(entry.label)
        && isNullableString(entry.note)
        && isNullableString(entry.diningOptionId),
    );
}

function isIdentityUnmapped(payload: unknown): boolean {
  return isRecord(payload) && payload.reason === "IDENTITY_UNMAPPED";
}

export async function handleOwnedPosReference(
  request: Request,
  dependencies: OwnedReferenceDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);

  if (!token) {
    return failure(401, "AUTH_REQUIRED", requestId);
  }

  let claimsResult: ReferenceClaimsResult;

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

  const requestedHeader = request.headers.get(POS_V2_ORGANIZATION_HEADER);
  const organizationId = requestedHeader || null;

  if (organizationId && !UUID_PATTERN.test(organizationId)) {
    return failure(403, "ORGANIZATION_FORBIDDEN", requestId);
  }

  let rpcResult: ReferenceRpcResult;

  try {
    rpcResult = await dependencies.loadReference(token, organizationId);

    if (!rpcResult.error && isIdentityUnmapped(rpcResult.data)) {
      rpcResult = await dependencies.loadReference(token, organizationId);
    }
  } catch {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  if (rpcResult.error) {
    return failure(503, "DATABASE_UNAVAILABLE", requestId);
  }

  const payload = rpcResult.data;

  if (!isRecord(payload)) {
    return failure(503, "INVALID_REFERENCE_RESPONSE", requestId);
  }

  if (payload.ok !== true) {
    const reason = isString(payload.reason)
      ? payload.reason
      : "POS_CONTEXT_UNAVAILABLE";

    return failure(
      reason === "IDENTITY_UNMAPPED" ? 401 : 403,
      reason,
      requestId,
    );
  }

  if (
    !isString(payload.organizationId)
    || !isString(payload.referenceVersion)
    || !isReferenceBundle(payload.reference)
  ) {
    return failure(503, "INVALID_REFERENCE_RESPONSE", requestId);
  }

  const body: PosReferenceV2Response = {
    ok: true,
    version: 2,
    requestId,
    organizationId: payload.organizationId,
    referenceVersion: payload.referenceVersion,
    reference: payload.reference,
  };
  const response = jsonResponse(body, 200, requestId);

  response.headers.set("x-tindio-reference-version", payload.referenceVersion);
  response.headers.set("etag", `"${payload.referenceVersion}"`);

  return response;
}
