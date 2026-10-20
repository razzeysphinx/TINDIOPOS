import type {
  JsonValue,
  PosReceiptDetail,
  PosReceiptPaymentType,
} from "@tindio/contracts/receipts";

import { POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECEIPT_DETAIL_PATH_PATTERN = /^\/api\/pos\/v2\/receipts\/([^/]+)\/?$/;
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

export type ReceiptDetailClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

export type ReceiptDetailDatabaseResult = {
  data: unknown;
  error: unknown;
};

export type OwnedReceiptDetailDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<ReceiptDetailClaimsResult>;
  loadCore: (
    token: string,
    organizationId: string | null,
  ) => Promise<ReceiptDetailDatabaseResult>;
  loadReceiptDetail: (
    token: string,
    organizationId: string,
    receiptId: string,
  ) => Promise<ReceiptDetailDatabaseResult>;
};

function jsonResponse(
  body: Record<string, unknown> | PosReceiptDetail,
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
  status: 400 | 401 | 403 | 404 | 503,
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
const isNullableNumber = (value: unknown): value is number | null =>
  value === null || isNumber(value);

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

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

function receiptIdFromRequest(request: Request): string | null {
  const match = RECEIPT_DETAIL_PATH_PATTERN.exec(new URL(request.url).pathname);
  if (!match) return null;

  try {
    const receiptId = decodeURIComponent(match[1]);
    return UUID_PATTERN.test(receiptId) ? receiptId : null;
  } catch {
    return null;
  }
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
    || isNumber(value)
  ) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isSaleItem(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && UUID_PATTERN.test(value.id)
    && isString(value.name)
    && isNullableString(value.sku)
    && isNumber(value.quantity)
    && isString(value.unit)
    && isNumber(value.unitPriceMinor)
    && isNumber(value.lineTotalMinor);
}

function isPayment(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && UUID_PATTERN.test(value.id)
    && isString(value.name)
    && isString(value.type)
    && PAYMENT_TYPES.has(value.type as PosReceiptPaymentType)
    && isNumber(value.amountMinor)
    && isNullableNumber(value.tenderedMinor)
    && isNullableNumber(value.changeMinor)
    && isNullableString(value.referenceNumber);
}

function isRefundItem(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && UUID_PATTERN.test(value.id)
    && isString(value.saleItemId)
    && UUID_PATTERN.test(value.saleItemId)
    && isString(value.name)
    && isNumber(value.quantity)
    && isString(value.unit)
    && isNumber(value.lineTotalMinor);
}

function isRefund(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id)
    && UUID_PATTERN.test(value.id)
    && isNumber(value.number)
    && isNumber(value.totalMinor)
    && isString(value.completedAt)
    && isString(value.reason)
    && isNullableString(value.paymentName)
    && isNullableString(value.paymentReference)
    && Array.isArray(value.items)
    && value.items.every(isRefundItem);
}

function isReceiptDetail(value: unknown): value is PosReceiptDetail {
  if (!isRecord(value) || !isRecord(value.receipt) || !isRecord(value.sale)) {
    return false;
  }

  const receipt = value.receipt;
  const sale = value.sale;
  return isString(receipt.id)
    && UUID_PATTERN.test(receipt.id)
    && isNumber(receipt.number)
    && isString(receipt.issuedAt)
    && isJsonValue(receipt.layout)
    && isNullableString(value.customerEmail)
    && isString(sale.id)
    && UUID_PATTERN.test(sale.id)
    && isString(sale.storeId)
    && UUID_PATTERN.test(sale.storeId)
    && isString(sale.registerId)
    && UUID_PATTERN.test(sale.registerId)
    && isString(sale.currencyCode)
    && isString(sale.organizationName)
    && isString(sale.storeName)
    && isString(sale.registerName)
    && isString(sale.cashierName)
    && isNumber(sale.subtotalMinor)
    && isNumber(sale.discountMinor)
    && isNumber(sale.taxMinor)
    && isNumber(sale.totalMinor)
    && Array.isArray(value.items)
    && value.items.every(isSaleItem)
    && Array.isArray(value.payments)
    && value.payments.every(isPayment)
    && Array.isArray(value.refunds)
    && value.refunds.every(isRefund);
}

export async function handleOwnedPosReceiptDetail(
  request: Request,
  dependencies: OwnedReceiptDetailDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);

  if (!token) {
    return failure(401, { ok: false, reason: "AUTH_REQUIRED" }, requestId);
  }

  let claimsResult: ReceiptDetailClaimsResult;
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

  let coreResult: ReceiptDetailDatabaseResult;
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

  const receiptId = receiptIdFromRequest(request);
  if (!receiptId) {
    return failure(400, {
      ok: false,
      message: "This receipt is invalid.",
    }, requestId);
  }

  let receiptResult: ReceiptDetailDatabaseResult;
  try {
    receiptResult = await dependencies.loadReceiptDetail(
      token,
      core.organization.id,
      receiptId,
    );
  } catch {
    return failure(503, { ok: false, reason: "DATABASE_UNAVAILABLE" }, requestId);
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

  if (receiptResult.data === null) {
    return failure(404, {
      ok: false,
      message: "This receipt is unavailable.",
    }, requestId);
  }
  if (!isReceiptDetail(receiptResult.data)) {
    return failure(503, { ok: false, reason: "INVALID_RECEIPT_RESPONSE" }, requestId);
  }

  return jsonResponse(receiptResult.data, 200, requestId);
}
