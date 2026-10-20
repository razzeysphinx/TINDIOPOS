import type {
  PosReceiptListResponse,
  PosReceiptPaymentType,
  PosReceiptSummary,
} from "@tindio/contracts/receipts";

import { POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set([
  "retail",
  "grocery",
  "convenience_store",
  "restaurant_cafe",
  "bar",
  "wholesale",
  "service",
  "other",
]);
const ORGANIZATION_STATUSES = new Set(["active", "suspended", "archived"]);
const PAYMENT_TYPES = new Set<PosReceiptPaymentType>([
  "CASH",
  "CARD",
  "E_WALLET",
  "BANK_TRANSFER",
  "VOUCHER",
  "OTHER",
]);

type ReceiptQuery = {
  query: string;
  beforeReceiptNumber?: number;
};

export type ReceiptsClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

export type ReceiptsDatabaseResult = {
  data: unknown;
  error: unknown;
};

export type OwnedReceiptsDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<ReceiptsClaimsResult>;
  loadCore: (
    token: string,
    organizationId: string | null,
  ) => Promise<ReceiptsDatabaseResult>;
  loadReceipts: (
    token: string,
    organizationId: string,
    query: ReceiptQuery,
  ) => Promise<ReceiptsDatabaseResult>;
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
  body: Record<string, unknown>,
  requestId: string,
): Response {
  return jsonResponse(body, status, requestId);
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

  const message = error instanceof Error ? error.message : "";
  if (
    /(?:invalid|malformed)[\s\S]*(?:token|jwt|jws|utf-8|signature)|expired[\s\S]*(?:token|jwt|jws)/i
      .test(message)
  ) return 401;

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
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || isString(value);

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isOrganizationSummary(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && UUID_PATTERN.test(value.id)
    && isString(value.name)
    && isString(value.status)
    && ORGANIZATION_STATUSES.has(value.status);
}

function isCoreContext(value: unknown): value is Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  permissions: string[];
} {
  if (!isRecord(value)) return false;

  const organization = value.organization;
  const employee = value.employee;

  return isString(value.profileId)
    && UUID_PATTERN.test(value.profileId)
    && isRecord(organization)
    && isString(organization.id)
    && UUID_PATTERN.test(organization.id)
    && isString(organization.name)
    && isString(organization.currencyCode)
    && isString(organization.timezone)
    && isString(organization.status)
    && ORGANIZATION_STATUSES.has(organization.status)
    && isString(organization.businessType)
    && isBoolean(organization.deviceManagementEnabled)
    && isRecord(employee)
    && isString(employee.id)
    && UUID_PATTERN.test(employee.id)
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

function parseQuery(request: Request): ReceiptQuery | null {
  const parameters = new URL(request.url).searchParams;
  const query = (parameters.get("q") ?? "").trim();
  const beforeValue = parameters.get("before");

  if (query.length > 100) return null;
  if (beforeValue === null) return { query };

  const beforeReceiptNumber = Number(beforeValue);
  return Number.isSafeInteger(beforeReceiptNumber) && beforeReceiptNumber > 0
    ? { query, beforeReceiptNumber }
    : null;
}

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

function isPaymentMethod(value: unknown): boolean {
  return isRecord(value)
    && isString(value.name)
    && isString(value.type)
    && PAYMENT_TYPES.has(value.type as PosReceiptPaymentType);
}

function isReceiptSummary(value: unknown): value is PosReceiptSummary {
  return isRecord(value)
    && isString(value.receipt_id)
    && UUID_PATTERN.test(value.receipt_id)
    && isString(value.sale_id)
    && UUID_PATTERN.test(value.sale_id)
    && isNumber(value.receipt_number)
    && isString(value.issued_at)
    && isString(value.store_id)
    && UUID_PATTERN.test(value.store_id)
    && isString(value.register_id)
    && UUID_PATTERN.test(value.register_id)
    && isString(value.store_name)
    && isString(value.register_name)
    && isString(value.cashier_name)
    && isNumber(value.total_minor)
    && isString(value.currency_code)
    && isNumber(value.refund_total_minor)
    && isNumber(value.refund_count)
    && isBoolean(value.has_refundable_quantity)
    && Array.isArray(value.payment_methods)
    && value.payment_methods.every(isPaymentMethod);
}

export async function handleOwnedPosReceipts(
  request: Request,
  dependencies: OwnedReceiptsDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);

  if (!token) {
    return failure(401, { ok: false, reason: "AUTH_REQUIRED" }, requestId);
  }

  let claimsResult: ReceiptsClaimsResult;
  try {
    claimsResult = await dependencies.verifyClaims(token);
  } catch (error) {
    const status = authErrorStatus(error);
    return failure(status, {
      ok: false,
      reason: status === 401 ? "AUTH_INVALID" : "AUTH_PROVIDER_UNAVAILABLE",
    }, requestId);
  }

  if (claimsResult.error || !claimsResult.data?.claims) {
    return failure(authErrorStatus(claimsResult.error), {
      ok: false,
      reason: claimsResult.error ? "AUTH_INVALID_OR_UNAVAILABLE" : "AUTH_INVALID",
    }, requestId);
  }

  const subject = claimsResult.data.claims.sub;
  if (!isString(subject) || subject.length === 0) {
    return failure(401, { ok: false, reason: "AUTH_INVALID" }, requestId);
  }

  const requestedOrganization = request.headers.get(POS_V2_ORGANIZATION_HEADER) || null;
  if (requestedOrganization && !UUID_PATTERN.test(requestedOrganization)) {
    return failure(403, { ok: false, reason: "ORGANIZATION_FORBIDDEN" }, requestId);
  }

  let coreResult: ReceiptsDatabaseResult;
  try {
    coreResult = await dependencies.loadCore(token, requestedOrganization);
    if (!coreResult.error && isIdentityUnmapped(coreResult.data)) {
      coreResult = await dependencies.loadCore(token, requestedOrganization);
    }
  } catch {
    return failure(503, { ok: false, reason: "DATABASE_UNAVAILABLE" }, requestId);
  }

  if (coreResult.error) {
    return failure(503, { ok: false, reason: "DATABASE_UNAVAILABLE" }, requestId);
  }
  if (!isRecord(coreResult.data)) {
    return failure(503, { ok: false, reason: "INVALID_CORE_RESPONSE" }, requestId);
  }
  if (coreResult.data.ok !== true) {
    const reason = isString(coreResult.data.reason)
      ? coreResult.data.reason
      : "POS_CONTEXT_UNAVAILABLE";
    return failure(reason === "IDENTITY_UNMAPPED" ? 401 : 403, {
      ok: false,
      reason,
    }, requestId);
  }
  if (!isCoreContext(coreResult.data)) {
    return failure(503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }, requestId);
  }

  const core = coreResult.data;
  if (core.organization.status !== "active") {
    return failure(403, { ok: false, reason: "ORGANIZATION_INACTIVE" }, requestId);
  }
  if (!BUSINESS_TYPES.has(core.organization.businessType)) {
    return failure(503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }, requestId);
  }
  if (
    !["pos.access", "sales.create", "receipts.view"]
      .every((permission) => core.permissions.includes(permission))
  ) {
    return failure(403, {
      ok: false,
      message: "Receipt access is not permitted.",
    }, requestId);
  }

  const query = parseQuery(request);
  if (!query) {
    return failure(400, {
      ok: false,
      message: "The receipt search is invalid.",
    }, requestId);
  }

  let receiptResult: ReceiptsDatabaseResult;
  try {
    receiptResult = await dependencies.loadReceipts(
      token,
      core.organization.id,
      query,
    );
  } catch {
    return failure(503, {
      ok: false,
      reason: "DATABASE_UNAVAILABLE",
    }, requestId);
  }

  if (receiptResult.error) {
    const code = isRecord(receiptResult.error) ? receiptResult.error.code : null;
    if (code === "42501") {
      return failure(403, {
        ok: false,
        message: "Receipt access is not permitted.",
      }, requestId);
    }
    return failure(503, { ok: false, reason: "DATABASE_UNAVAILABLE" }, requestId);
  }

  const receipts = receiptResult.data ?? [];
  if (!Array.isArray(receipts) || !receipts.every(isReceiptSummary)) {
    return failure(503, { ok: false, reason: "INVALID_RECEIPTS_RESPONSE" }, requestId);
  }

  const body: PosReceiptListResponse = {
    receipts,
    hasMore: receipts.length === 25,
  };
  return jsonResponse(body, 200, requestId);
}
