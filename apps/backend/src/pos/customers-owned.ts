import type {
  PosCustomer,
  PosCustomerSearchResponse,
} from "@tindio/contracts/pos-data";

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

type CustomerQuery = {
  store: string;
  query: string;
};

export type CustomersClaimsResult = {
  data?: { claims?: Record<string, unknown> } | null;
  error?: unknown;
};

export type CustomersDatabaseResult = {
  data: unknown;
  error: unknown;
};

export type OwnedCustomersDependencies = {
  createRequestId: () => string;
  verifyClaims: (token: string) => Promise<CustomersClaimsResult>;
  loadCore: (
    token: string,
    organizationId: string | null,
  ) => Promise<CustomersDatabaseResult>;
  findActiveShift: (
    token: string,
    organizationId: string,
    storeId: string,
    employeeId: string,
  ) => Promise<CustomersDatabaseResult>;
  searchCustomers: (
    token: string,
    organizationId: string,
    query: CustomerQuery,
  ) => Promise<CustomersDatabaseResult>;
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
  status: 400 | 401 | 403 | 500 | 503,
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
  employee: Record<string, unknown> & { id: string };
  permissions: string[];
  storeIds: string[];
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

function parseQuery(request: Request): CustomerQuery | null {
  const input = Object.fromEntries(new URL(request.url).searchParams.entries());
  const store = input.store;
  const query = input.q === undefined ? "" : input.q.trim();

  return isString(store)
    && UUID_PATTERN.test(store)
    && isString(query)
    && query.length <= 100
      ? { store, query }
      : null;
}

function isIdentityUnmapped(value: unknown): boolean {
  return isRecord(value) && value.reason === "IDENTITY_UNMAPPED";
}

function isCustomerRow(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && isString(value.customer_id)
    && UUID_PATTERN.test(value.customer_id)
    && isNumber(value.customer_number)
    && isString(value.loyalty_card_code)
    && isString(value.full_name)
    && isNullableString(value.phone)
    && isNullableString(value.email)
    && isNumber(value.loyalty_points);
}

function mapCustomer(row: Record<string, unknown>): PosCustomer {
  return {
    id: row.customer_id as string,
    customerNumber: row.customer_number as number,
    loyaltyCardCode: row.loyalty_card_code as string,
    fullName: row.full_name as string,
    phone: row.phone as string | null,
    email: row.email as string | null,
    loyaltyPoints: row.loyalty_points as number,
  };
}

export async function handleOwnedPosCustomers(
  request: Request,
  dependencies: OwnedCustomersDependencies,
): Promise<Response> {
  const requestId = dependencies.createRequestId();
  const token = bearerFromRequest(request);

  if (!token) {
    return failure(401, { ok: false, reason: "AUTH_REQUIRED" }, requestId);
  }

  let claimsResult: CustomersClaimsResult;
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

  let coreResult: CustomersDatabaseResult;
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
    !core.permissions.includes("pos.access")
    || !core.permissions.includes("sales.create")
  ) {
    return failure(403, { error: "POS access is not permitted." }, requestId);
  }

  const query = parseQuery(request);
  if (!query || !core.storeIds.includes(query.store)) {
    return failure(400, { error: "Choose an assigned store." }, requestId);
  }

  let shiftResult: CustomersDatabaseResult;
  try {
    shiftResult = await dependencies.findActiveShift(
      token,
      core.organization.id,
      query.store,
      core.employee.id,
    );
  } catch {
    return failure(500, {
      error: "The active register shift could not be verified.",
    }, requestId);
  }

  if (shiftResult.error) {
    return failure(500, {
      error: "The active register shift could not be verified.",
    }, requestId);
  }
  if (!shiftResult.data) {
    return failure(403, {
      error: "Open a register shift before looking up customers.",
    }, requestId);
  }

  let customerResult: CustomersDatabaseResult;
  try {
    customerResult = await dependencies.searchCustomers(
      token,
      core.organization.id,
      query,
    );
  } catch {
    return failure(500, {
      error: "Customers could not be loaded for this sale.",
    }, requestId);
  }

  if (customerResult.error) {
    const code = isRecord(customerResult.error) ? customerResult.error.code : null;
    return failure(code === "42501" ? 403 : 500, {
      error: "Customers could not be loaded for this sale.",
    }, requestId);
  }

  const rows = customerResult.data ?? [];
  if (!Array.isArray(rows) || !rows.every(isCustomerRow)) {
    return failure(503, { ok: false, reason: "INVALID_CUSTOMERS_RESPONSE" }, requestId);
  }

  const body: PosCustomerSearchResponse = {
    customers: rows.map(mapCustomer),
  };
  return jsonResponse(body, 200, requestId);
}
