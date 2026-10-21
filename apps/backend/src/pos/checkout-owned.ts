import {
  POS_CHECKOUT_REQUEST_INVALID_MESSAGE,
  POS_CHECKOUT_UNCONFIRMED_MESSAGE,
  type CheckoutDeviceCredential,
  type CheckoutSaleActionResult,
  type CheckoutSaleValues,
} from "@tindio/contracts/checkout";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  mapCheckoutRpcResult,
  validateCheckout,
  type CheckoutRpcRow,
} from "./checkout-compatibility.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set([
  "retail", "grocery", "convenience_store", "restaurant_cafe",
  "bar", "wholesale", "service", "other",
]);
const ORGANIZATION_STATUSES = new Set(["active", "suspended", "archived"]);

type ClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};
type DatabaseResult = { data: unknown; error: unknown };

export type OwnedCheckoutDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  checkout: (
    token: string,
    organizationId: string,
    input: CheckoutSaleValues,
    device: CheckoutDeviceCredential | null | undefined,
  ) => Promise<DatabaseResult>;
  loadStockWarning: (
    token: string,
    organizationId: string,
    storeId: string,
    saleId: string,
  ) => Promise<DatabaseResult>;
};

function jsonResponse(body: CheckoutSaleActionResult | Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function contextFailure(status: 401 | 403 | 503, reason: string): Response {
  return jsonResponse({ ok: false, reason }, status);
}

function unconfirmedResponse(): Response {
  return jsonResponse({
    ok: false,
    message: POS_CHECKOUT_UNCONFIRMED_MESSAGE,
    retryable: true,
  }, 500);
}

function bearerFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const token = /^Bearer ([^\s]+)$/i.exec(authorization.trim())?.[1];
  return token && token.length <= MAX_TOKEN_LENGTH && token.split(".").length === 3
    ? token
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const isString = (value: unknown): value is string => typeof value === "string";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);

function isOrganizationSummary(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id) && UUID_PATTERN.test(value.id)
    && isString(value.name)
    && isString(value.status) && ORGANIZATION_STATUSES.has(value.status);
}

type CoreContext = Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  permissions: string[];
  storeIds: string[];
};

function isCoreContext(value: unknown): value is CoreContext {
  if (!isRecord(value)) return false;
  const organization = value.organization;
  const employee = value.employee;
  return isString(value.profileId) && UUID_PATTERN.test(value.profileId)
    && isRecord(organization)
    && isString(organization.id) && UUID_PATTERN.test(organization.id)
    && isString(organization.name)
    && isString(organization.currencyCode)
    && isString(organization.timezone)
    && isString(organization.status) && ORGANIZATION_STATUSES.has(organization.status)
    && isString(organization.businessType)
    && isBoolean(organization.deviceManagementEnabled)
    && isRecord(employee)
    && isString(employee.id) && UUID_PATTERN.test(employee.id)
    && isString(employee.employeeNumber)
    && isNullableString(employee.jobTitle)
    && isString(employee.name)
    && Array.isArray(value.availableOrganizations)
    && value.availableOrganizations.every(isOrganizationSummary)
    && strings(value.roleNames)
    && strings(value.permissions)
    && Array.isArray(value.storeIds)
    && value.storeIds.every((storeId) => isString(storeId) && UUID_PATTERN.test(storeId))
    && isRecord(value.features)
    && Object.values(value.features).every(isBoolean);
}

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

function rpcError(error: unknown): { code?: string; message?: string } | null {
  if (!isRecord(error)) return null;
  return {
    code: isString(error.code) ? error.code : undefined,
    message: isString(error.message) ? error.message : undefined,
  };
}

function checkoutRow(value: unknown): CheckoutRpcRow | null {
  const row = Array.isArray(value) ? value[0] : null;
  if (!isRecord(row)
    || !isString(row.sale_id) || !UUID_PATTERN.test(row.sale_id)
    || typeof row.receipt_number !== "number"
    || typeof row.total_minor !== "number"
    || typeof row.change_minor !== "number"
    || typeof row.was_replayed !== "boolean") return null;
  return {
    sale_id: row.sale_id,
    receipt_number: row.receipt_number,
    total_minor: row.total_minor,
    change_minor: row.change_minor,
    payment_summary: row.payment_summary,
    was_replayed: row.was_replayed,
  };
}

export async function handleOwnedCheckout(
  request: Request,
  dependencies: OwnedCheckoutDependencies,
): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      message: POS_CHECKOUT_REQUEST_INVALID_MESSAGE,
      retryable: false,
    }, 400);
  }

  const token = bearerFromRequest(request);
  if (!token) return contextFailure(401, "AUTH_REQUIRED");

  let claimsResult: ClaimsResult;
  try {
    claimsResult = await dependencies.verifyClaims(token);
  } catch (error) {
    const status = authErrorStatus(error);
    return contextFailure(status, status === 401 ? "AUTH_INVALID" : "AUTH_PROVIDER_UNAVAILABLE");
  }
  if (claimsResult.error || !claimsResult.data?.claims) {
    return contextFailure(
      authErrorStatus(claimsResult.error),
      claimsResult.error ? "AUTH_INVALID_OR_UNAVAILABLE" : "AUTH_INVALID",
    );
  }
  const subject = claimsResult.data.claims.sub;
  if (!isString(subject) || subject.length === 0) return contextFailure(401, "AUTH_INVALID");

  const requestedOrganization = request.headers.get(POS_V2_ORGANIZATION_HEADER) || null;
  if (requestedOrganization && !UUID_PATTERN.test(requestedOrganization)) {
    return contextFailure(403, "ORGANIZATION_FORBIDDEN");
  }

  let coreResult: DatabaseResult;
  try {
    coreResult = await dependencies.loadCore(token, requestedOrganization);
    if (!coreResult.error && isIdentityUnmapped(coreResult.data)) {
      coreResult = await dependencies.loadCore(token, requestedOrganization);
    }
  } catch {
    return contextFailure(503, "DATABASE_UNAVAILABLE");
  }
  if (coreResult.error) return contextFailure(503, "DATABASE_UNAVAILABLE");
  if (!isRecord(coreResult.data)) return contextFailure(503, "INVALID_CORE_RESPONSE");
  if (coreResult.data.ok !== true) {
    const reason = isString(coreResult.data.reason)
      ? coreResult.data.reason
      : "POS_CONTEXT_UNAVAILABLE";
    return contextFailure(reason === "IDENTITY_UNMAPPED" ? 401 : 403, reason);
  }
  if (!isCoreContext(coreResult.data)) return contextFailure(503, "INVALID_BUSINESS_CONTEXT");

  const core = coreResult.data;
  if (core.organization.status !== "active") return contextFailure(403, "ORGANIZATION_INACTIVE");
  if (!BUSINESS_TYPES.has(core.organization.businessType)) {
    return contextFailure(503, "INVALID_BUSINESS_TYPE");
  }

  const validation = validateCheckout(body, {
    permissions: core.permissions,
    assignedStoreIds: core.storeIds,
  });
  if (!validation.ok) {
    return jsonResponse(
      validation.result,
      validation.result.ok ? 200 : validation.result.retryable ? 503 : 409,
    );
  }

  try {
    const checkoutResult = await dependencies.checkout(
      token,
      core.organization.id,
      validation.input,
      validation.device,
    );
    const row = checkoutRow(checkoutResult.data);
    const error = rpcError(checkoutResult.error);
    if (error || !row) {
      const result = mapCheckoutRpcResult(null, error);
      return jsonResponse(result, result.ok ? 200 : result.retryable ? 503 : 409);
    }

    const stockResult = await dependencies.loadStockWarning(
      token,
      core.organization.id,
      validation.input.storeId,
      row.sale_id,
    );
    const negativeStockItemCount = typeof stockResult.data === "number"
      ? stockResult.data
      : null;
    return jsonResponse(mapCheckoutRpcResult(row, null, negativeStockItemCount), 200);
  } catch {
    return unconfirmedResponse();
  }
}
