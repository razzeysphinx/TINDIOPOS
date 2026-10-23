import {
  POS_RECEIPT_DELIVERY_RECEIPT_INVALID_MESSAGE,
  POS_RECEIPT_DELIVERY_REQUEST_INVALID_MESSAGE,
  type ReceiptDeliveryDatabaseRow,
  type ReceiptDeliveryValues,
} from "@tindio/contracts/receipt-delivery";
import {
  POS_RECEIPT_SETTINGS_REQUEST_INVALID_MESSAGE,
  type ReceiptSettingsValues,
} from "@tindio/contracts/receipt-settings";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  mapReceiptDeliveryRpcResult,
  mapReceiptSettingsRpcResult,
  validateReceiptDelivery,
  validateReceiptSettings,
} from "./receipt-administration-compatibility.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DELIVERY_PATH_PATTERN = /^\/api\/pos\/v2\/receipts\/([^/]+)\/delivery\/?$/;
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

export type OwnedReceiptAdministrationDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  updateSettings: (
    token: string,
    organizationId: string,
    input: ReceiptSettingsValues,
  ) => Promise<DatabaseResult>;
  queueDelivery: (
    token: string,
    organizationId: string,
    input: ReceiptDeliveryValues,
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

type OwnedCore = Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  permissions: string[];
};

function isCoreContext(value: unknown): value is OwnedCore {
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

function databaseError(value: unknown): { code?: string; message?: string } | null {
  if (!isRecord(value)) return null;
  return {
    ...(isString(value.code) ? { code: value.code } : {}),
    ...(isString(value.message) ? { message: value.message } : {}),
  };
}

function isReceiptDeliveryRow(value: unknown): value is ReceiptDeliveryDatabaseRow {
  return isRecord(value)
    && isString(value.delivery_request_id) && UUID_PATTERN.test(value.delivery_request_id)
    && isString(value.delivery_status)
    && isBoolean(value.was_replayed);
}

type ContextResult =
  | { ok: true; token: string; core: OwnedCore }
  | { ok: false; response: Response };

async function loadOwnedContext(
  request: Request,
  dependencies: OwnedReceiptAdministrationDependencies,
): Promise<ContextResult> {
  const token = bearerFromRequest(request);
  if (!token) return { ok: false, response: contextFailure(401, "AUTH_REQUIRED") };

  let claimsResult: ClaimsResult;
  try {
    claimsResult = await dependencies.verifyClaims(token);
  } catch (error) {
    const status = authErrorStatus(error);
    return {
      ok: false,
      response: contextFailure(status, status === 401 ? "AUTH_INVALID" : "AUTH_PROVIDER_UNAVAILABLE"),
    };
  }
  if (claimsResult.error || !claimsResult.data?.claims) {
    return {
      ok: false,
      response: contextFailure(
        authErrorStatus(claimsResult.error),
        claimsResult.error ? "AUTH_INVALID_OR_UNAVAILABLE" : "AUTH_INVALID",
      ),
    };
  }
  const subject = claimsResult.data.claims.sub;
  if (!isString(subject) || subject.length === 0) {
    return { ok: false, response: contextFailure(401, "AUTH_INVALID") };
  }

  const requestedOrganization = request.headers.get(POS_V2_ORGANIZATION_HEADER) || null;
  if (requestedOrganization && !UUID_PATTERN.test(requestedOrganization)) {
    return { ok: false, response: contextFailure(403, "ORGANIZATION_FORBIDDEN") };
  }

  let coreResult: DatabaseResult;
  try {
    coreResult = await dependencies.loadCore(token, requestedOrganization);
    if (!coreResult.error && isIdentityUnmapped(coreResult.data)) {
      coreResult = await dependencies.loadCore(token, requestedOrganization);
    }
  } catch {
    return { ok: false, response: contextFailure(503, "DATABASE_UNAVAILABLE") };
  }
  if (coreResult.error) {
    return { ok: false, response: contextFailure(503, "DATABASE_UNAVAILABLE") };
  }
  if (!isRecord(coreResult.data)) {
    return { ok: false, response: contextFailure(503, "INVALID_CORE_RESPONSE") };
  }
  if (coreResult.data.ok !== true) {
    const reason = isString(coreResult.data.reason)
      ? coreResult.data.reason
      : "POS_CONTEXT_UNAVAILABLE";
    return {
      ok: false,
      response: contextFailure(reason === "IDENTITY_UNMAPPED" ? 401 : 403, reason),
    };
  }
  if (!isCoreContext(coreResult.data)) {
    return { ok: false, response: contextFailure(503, "INVALID_BUSINESS_CONTEXT") };
  }
  if (coreResult.data.organization.status !== "active") {
    return { ok: false, response: contextFailure(403, "ORGANIZATION_INACTIVE") };
  }
  if (!BUSINESS_TYPES.has(coreResult.data.organization.businessType)) {
    return { ok: false, response: contextFailure(503, "INVALID_BUSINESS_TYPE") };
  }
  return { ok: true, token, core: coreResult.data };
}

export async function handleOwnedReceiptSettings(
  request: Request,
  dependencies: OwnedReceiptAdministrationDependencies,
): Promise<Response> {
  const context = await loadOwnedContext(request, dependencies);
  if (!context.ok) return context.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: POS_RECEIPT_SETTINGS_REQUEST_INVALID_MESSAGE }, 400);
  }
  const validation = validateReceiptSettings(body, { permissions: context.core.permissions });
  if (!validation.ok) return jsonResponse(validation.result);

  let result: DatabaseResult;
  try {
    result = await dependencies.updateSettings(
      context.token,
      context.core.organization.id,
      validation.input,
    );
  } catch {
    return jsonResponse(mapReceiptSettingsRpcResult(null, null));
  }
  return jsonResponse(mapReceiptSettingsRpcResult(
    result.data === true ? true : null,
    databaseError(result.error),
  ));
}

export async function handleOwnedReceiptDelivery(
  request: Request,
  dependencies: OwnedReceiptAdministrationDependencies,
): Promise<Response> {
  const context = await loadOwnedContext(request, dependencies);
  if (!context.ok) return context.response;

  const pathMatch = DELIVERY_PATH_PATTERN.exec(new URL(request.url).pathname);
  const receiptId = pathMatch?.[1];
  if (!receiptId || !UUID_PATTERN.test(receiptId)) {
    return jsonResponse({ ok: false, message: POS_RECEIPT_DELIVERY_RECEIPT_INVALID_MESSAGE }, 400);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: POS_RECEIPT_DELIVERY_REQUEST_INVALID_MESSAGE }, 400);
  }
  const input = { ...(isRecord(body) ? body : {}), receiptId };
  const validation = validateReceiptDelivery(input, { permissions: context.core.permissions });
  if (!validation.ok) return jsonResponse(validation.result);

  let result: DatabaseResult;
  try {
    result = await dependencies.queueDelivery(
      context.token,
      context.core.organization.id,
      validation.input,
    );
  } catch {
    return jsonResponse(mapReceiptDeliveryRpcResult(null, null));
  }
  const rows = Array.isArray(result.data)
    && result.data.length > 0
    && isReceiptDeliveryRow(result.data[0])
      ? [result.data[0]]
      : null;
  return jsonResponse(mapReceiptDeliveryRpcResult(rows, databaseError(result.error)));
}
