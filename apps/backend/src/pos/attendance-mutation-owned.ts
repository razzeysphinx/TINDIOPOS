import {
  POS_ATTENDANCE_REQUEST_INVALID_MESSAGE,
  type AttendanceMutationRow,
  type ClockInValues,
  type ClockOutValues,
} from "@tindio/contracts/attendance-mutation";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  mapClockInRpcResult,
  mapClockOutRpcResult,
  validateAttendanceMutationRoute,
  validateClockInMutation,
  validateClockOutMutation,
} from "./attendance-mutation-compatibility.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set([
  "retail", "grocery", "convenience_store", "restaurant_cafe",
  "bar", "wholesale", "service", "other",
]);
const ORGANIZATION_STATUSES = new Set(["active", "suspended", "archived"]);

export type AttendanceMutationAction = "clock-in" | "clock-out";
type ClaimsResult = { data?: { claims?: Record<string, unknown> } | null; error?: unknown };
type DatabaseResult = { data: unknown; error: unknown };

export type OwnedAttendanceMutationDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  clockIn: (token: string, organizationId: string, input: ClockInValues) => Promise<DatabaseResult>;
  clockOut: (token: string, organizationId: string, input: ClockOutValues) => Promise<DatabaseResult>;
};

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
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
const isNullableString = (value: unknown): value is string | null => value === null || isString(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString);

function isOrganizationSummary(value: unknown): boolean {
  return isRecord(value)
    && isString(value.id) && UUID_PATTERN.test(value.id)
    && isString(value.name)
    && isString(value.status) && ORGANIZATION_STATUSES.has(value.status);
}

function isCoreContext(value: unknown): value is Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  permissions: string[];
  storeIds: string[];
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

function databaseError(value: unknown): { code?: string; message?: string } | null {
  if (!isRecord(value)) return null;
  return {
    ...(isString(value.code) ? { code: value.code } : {}),
    ...(isString(value.message) ? { message: value.message } : {}),
  };
}

function attendanceRow(value: unknown): AttendanceMutationRow | null {
  if (!isRecord(value)
    || !isString(value.result_code)
    || !isString(value.message)
    || !isBoolean(value.was_replayed)) return null;
  for (const key of [
    "entry_id", "employee_id", "employee_name", "store_id", "store_name",
    "clocked_in_at", "clocked_out_at", "shift_id", "register_id",
    "register_name", "shift_opened_at",
  ]) if (!isNullableString(value[key])) return null;
  if ((value.result_code === "CLOCKED_IN" || value.result_code === "CLOCKED_OUT")
    && (!isString(value.employee_id) || !isString(value.employee_name)
      || !isString(value.store_id) || !isString(value.store_name))) return null;
  return value as AttendanceMutationRow;
}

export async function handleOwnedAttendanceMutation(
  request: Request,
  action: AttendanceMutationAction,
  dependencies: OwnedAttendanceMutationDependencies,
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
    const reason = isString(coreResult.data.reason) ? coreResult.data.reason : "POS_CONTEXT_UNAVAILABLE";
    return contextFailure(reason === "IDENTITY_UNMAPPED" ? 401 : 403, reason);
  }
  if (!isCoreContext(coreResult.data)) return contextFailure(503, "INVALID_BUSINESS_CONTEXT");

  const core = coreResult.data;
  if (core.organization.status !== "active") return contextFailure(403, "ORGANIZATION_INACTIVE");
  if (!BUSINESS_TYPES.has(core.organization.businessType)) {
    return contextFailure(503, "INVALID_BUSINESS_TYPE");
  }

  const routeValidation = validateAttendanceMutationRoute({
    timeClockEnabled: core.features.time_clock === true,
    permissions: core.permissions,
    storeIds: core.storeIds,
  });
  if (!routeValidation.ok) return jsonResponse(routeValidation.result);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: POS_ATTENDANCE_REQUEST_INVALID_MESSAGE }, 400);
  }

  if (action === "clock-in") {
    const validation = validateClockInMutation(body, core.storeIds);
    if (!validation.ok) return jsonResponse(validation.result);
    let result: DatabaseResult;
    try {
      result = await dependencies.clockIn(token, core.organization.id, validation.input);
    } catch {
      return jsonResponse(mapClockInRpcResult(null, null));
    }
    const row = Array.isArray(result.data) ? attendanceRow(result.data[0]) : null;
    return jsonResponse(mapClockInRpcResult(row, databaseError(result.error)));
  }

  const validation = validateClockOutMutation(body);
  if (!validation.ok) return jsonResponse(validation.result);
  let result: DatabaseResult;
  try {
    result = await dependencies.clockOut(token, core.organization.id, validation.input);
  } catch {
    return jsonResponse(mapClockOutRpcResult(null, null));
  }
  const row = Array.isArray(result.data) ? attendanceRow(result.data[0]) : null;
  return jsonResponse(mapClockOutRpcResult(row, databaseError(result.error)));
}
