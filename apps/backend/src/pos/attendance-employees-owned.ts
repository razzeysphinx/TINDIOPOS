import type {
  AttendanceEmployee,
  AttendanceEmployeesResult,
} from "@tindio/contracts/attendance";

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

type AttendanceEmployeeRow = {
  employee_id: string;
  employee_number: string;
  employee_name: string;
  pin_is_set: boolean;
  entry_id: string | null;
  entry_store_id: string | null;
  entry_store_name: string | null;
  clocked_in_at: string | null;
};

export type AttendanceEmployeesClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

export type AttendanceEmployeesDatabaseResult = {
  data: unknown;
  error: unknown;
};

export type OwnedAttendanceEmployeesDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<AttendanceEmployeesClaimsResult>;
  loadCore: (
    token: string,
    organizationId: string | null,
  ) => Promise<AttendanceEmployeesDatabaseResult>;
  loadAttendanceEmployees: (
    token: string,
    organizationId: string,
    storeId: string,
  ) => Promise<AttendanceEmployeesDatabaseResult>;
};

function jsonResponse(
  body: Record<string, unknown> | AttendanceEmployeesResult,
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
  body: Record<string, unknown> | AttendanceEmployeesResult,
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
  storeIds: string[];
  features: Record<string, boolean>;
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

function isAttendanceEmployeeRow(value: unknown): value is AttendanceEmployeeRow {
  return isRecord(value)
    && isString(value.employee_id)
    && UUID_PATTERN.test(value.employee_id)
    && isString(value.employee_number)
    && isString(value.employee_name)
    && isBoolean(value.pin_is_set)
    && isNullableString(value.entry_id)
    && (value.entry_id === null || UUID_PATTERN.test(value.entry_id))
    && isNullableString(value.entry_store_id)
    && (value.entry_store_id === null || UUID_PATTERN.test(value.entry_store_id))
    && isNullableString(value.entry_store_name)
    && isNullableString(value.clocked_in_at);
}

function mapAttendanceEmployee(employee: AttendanceEmployeeRow): AttendanceEmployee {
  return {
    id: employee.employee_id,
    employeeNumber: employee.employee_number,
    name: employee.employee_name,
    pinIsSet: employee.pin_is_set,
    entry: employee.entry_id && employee.clocked_in_at && employee.entry_store_id
      ? {
          id: employee.entry_id,
          employeeId: employee.employee_id,
          employeeName: employee.employee_name,
          storeId: employee.entry_store_id,
          storeName: employee.entry_store_name ?? "Assigned store",
          clockedInAt: employee.clocked_in_at,
        }
      : null,
  };
}

function attendanceLoadFailure(requestId: string): Response {
  return jsonResponse({
    ok: false,
    message: "TINDIO could not load employees for attendance.",
    employees: [],
  }, 200, requestId);
}

export async function handleOwnedPosAttendanceEmployees(
  request: Request,
  dependencies: OwnedAttendanceEmployeesDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);

  if (!token) {
    return failure(401, { ok: false, reason: "AUTH_REQUIRED" }, requestId);
  }

  let claimsResult: AttendanceEmployeesClaimsResult;
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

  let coreResult: AttendanceEmployeesDatabaseResult;
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
  if (!core.features.time_clock || !core.permissions.includes("attendance.use")) {
    return failure(403, {
      ok: false,
      message: "Attendance is unavailable for this store.",
      employees: [],
    }, requestId);
  }

  const storeId = new URL(request.url).searchParams.get("store");
  if (!storeId || !UUID_PATTERN.test(storeId) || !core.storeIds.includes(storeId)) {
    return failure(400, {
      ok: false,
      message: "Choose one of your assigned stores.",
      employees: [],
    }, requestId);
  }

  let employeesResult: AttendanceEmployeesDatabaseResult;
  try {
    employeesResult = await dependencies.loadAttendanceEmployees(
      token,
      core.organization.id,
      storeId,
    );
  } catch {
    return attendanceLoadFailure(requestId);
  }

  const rows = employeesResult.data ?? [];
  if (
    employeesResult.error
    || !Array.isArray(rows)
    || !rows.every(isAttendanceEmployeeRow)
  ) {
    return attendanceLoadFailure(requestId);
  }

  return jsonResponse({
    ok: true,
    employees: rows.map(mapAttendanceEmployee),
  }, 200, requestId);
}
