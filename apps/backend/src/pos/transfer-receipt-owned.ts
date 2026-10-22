import {
  POS_TRANSFER_RECEIPT_REQUEST_INVALID_MESSAGE,
  type ReceiveStockTransferValues,
} from "@tindio/contracts/transfer-receipt";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  mapTransferReceiptRpcResult,
  toTransferScopedReceiptInput,
  validateTransferReceipt,
  validateTransferReceiptId,
} from "./transfer-receipt-compatibility.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRANSFER_RECEIPT_PATH_PATTERN = /^\/api\/pos\/v2\/transfers\/([^/]+)\/receive\/?$/;
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

export type OwnedTransferReceiptDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  receive: (
    token: string,
    organizationId: string,
    input: ReceiveStockTransferValues,
  ) => Promise<DatabaseResult>;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function contextFailure(status: 401 | 403 | 503, reason: string): Response {
  return jsonResponse({ ok: false, reason }, status);
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

function isCoreContext(value: unknown): value is Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  permissions: string[];
  features: Record<string, boolean>;
} {
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

function transferIdFromRequest(request: Request): string | null {
  const match = TRANSFER_RECEIPT_PATH_PATTERN.exec(new URL(request.url).pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function databaseError(value: unknown): { code?: string } | null {
  if (!isRecord(value)) return null;
  return isString(value.code) ? { code: value.code } : {};
}

export async function handleOwnedTransferReceipt(
  request: Request,
  dependencies: OwnedTransferReceiptDependencies,
): Promise<Response> {
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

  const transferValidation = validateTransferReceiptId(transferIdFromRequest(request));
  if (!transferValidation.ok) return jsonResponse(transferValidation.result, transferValidation.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: POS_TRANSFER_RECEIPT_REQUEST_INVALID_MESSAGE }, 400);
  }

  const validation = validateTransferReceipt(
    toTransferScopedReceiptInput(body, transferValidation.transferId),
    {
      inventoryEnabled: core.features.inventory === true,
      transfersEnabled: core.features.transfers === true,
      permissions: core.permissions,
    },
  );
  if (!validation.ok) return jsonResponse(validation.result);

  let receiptResult: DatabaseResult;
  try {
    receiptResult = await dependencies.receive(token, core.organization.id, validation.input);
  } catch {
    return jsonResponse(mapTransferReceiptRpcResult(null, null));
  }
  const receiptId = isString(receiptResult.data) && UUID_PATTERN.test(receiptResult.data)
    ? receiptResult.data
    : null;
  return jsonResponse(mapTransferReceiptRpcResult(receiptId, databaseError(receiptResult.error)));
}
