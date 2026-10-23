import {
  POS_CART_STOCK_VALIDATION_RPC,
  type ValidateCartStockValues,
} from "@tindio/contracts/checkout";
import {
  POS_STOCK_REQUEST_RECEIPT_RPC,
  type ReceiveStockRequestValues,
} from "@tindio/contracts/stock-request-receipt";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  mapCartStockValidationResult,
  mapStockRequestReceiptResult,
  stockRequestIdFromReceiptPath,
  toCartStockValidationRpcArguments,
  toStockRequestReceiptRpcArguments,
  validateCartStockOperation,
  validateStockRequestReceipt,
  validateStockRequestReceiptId,
} from "./stock-operations-compatibility.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set(["retail", "grocery", "convenience_store", "restaurant_cafe", "bar", "wholesale", "service", "other"]);
const ORGANIZATION_STATUSES = new Set(["active", "suspended", "archived"]);

type ClaimsResult = { data?: { claims?: Record<string, unknown> } | null; error?: unknown };
type DatabaseResult = { data: unknown; error: unknown };
type CoreContext = Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  permissions: string[];
  storeIds: string[];
  features: Record<string, boolean>;
};

export type StockOperationAction = "validate-cart" | "receive-request";
export type OwnedStockOperationsDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  validateCart: (token: string, organizationId: string, input: ValidateCartStockValues) => Promise<DatabaseResult>;
  receiveRequest: (token: string, organizationId: string, input: ReceiveStockRequestValues) => Promise<DatabaseResult>;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
const string = (value: unknown): value is string => typeof value === "string";
const boolean = (value: unknown): value is boolean => typeof value === "boolean";
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(string);
function organization(value: unknown): boolean {
  return record(value) && string(value.id) && UUID_PATTERN.test(value.id) && string(value.name)
    && string(value.status) && ORGANIZATION_STATUSES.has(value.status);
}
function core(value: unknown): value is CoreContext {
  if (!record(value) || !record(value.organization) || !record(value.employee)) return false;
  const org = value.organization;
  const employee = value.employee;
  return string(value.profileId) && UUID_PATTERN.test(value.profileId)
    && string(org.id) && UUID_PATTERN.test(org.id) && string(org.name) && string(org.currencyCode)
    && string(org.timezone) && string(org.status) && ORGANIZATION_STATUSES.has(org.status)
    && string(org.businessType) && boolean(org.deviceManagementEnabled)
    && string(employee.id) && UUID_PATTERN.test(employee.id) && string(employee.employeeNumber)
    && nullableString(employee.jobTitle) && string(employee.name)
    && Array.isArray(value.availableOrganizations) && value.availableOrganizations.every(organization)
    && strings(value.roleNames) && strings(value.permissions) && Array.isArray(value.storeIds)
    && value.storeIds.every((id) => string(id) && UUID_PATTERN.test(id))
    && record(value.features) && Object.values(value.features).every(boolean);
}
function bearer(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  const token = authorization ? /^Bearer ([^\s]+)$/i.exec(authorization.trim())?.[1] : null;
  return token && token.length <= MAX_TOKEN_LENGTH && token.split(".").length === 3 ? token : null;
}
function databaseError(value: unknown): { code?: string; message?: string } | null {
  return record(value) ? {
    ...(string(value.code) ? { code: value.code } : {}),
    ...(string(value.message) ? { message: value.message } : {}),
  } : null;
}

type ContextResult = { ok: true; token: string; core: CoreContext } | { ok: false; response: Response };
async function loadContext(request: Request, dependencies: OwnedStockOperationsDependencies): Promise<ContextResult> {
  const token = bearer(request);
  if (!token) return { ok: false, response: json({ ok: false, reason: "AUTH_REQUIRED" }, 401) };
  let claims: ClaimsResult;
  try { claims = await dependencies.verifyClaims(token); }
  catch (error) {
    const status = authErrorStatus(error);
    return { ok: false, response: json({ ok: false, reason: status === 401 ? "AUTH_INVALID" : "AUTH_PROVIDER_UNAVAILABLE" }, status) };
  }
  if (claims.error || !claims.data?.claims || !string(claims.data.claims.sub) || !claims.data.claims.sub) {
    const status = claims.error ? authErrorStatus(claims.error) : 401;
    return { ok: false, response: json({ ok: false, reason: claims.error ? "AUTH_INVALID_OR_UNAVAILABLE" : "AUTH_INVALID" }, status) };
  }
  const requested = request.headers.get(POS_V2_ORGANIZATION_HEADER) || null;
  if (requested && !UUID_PATTERN.test(requested)) return { ok: false, response: json({ ok: false, reason: "ORGANIZATION_FORBIDDEN" }, 403) };
  let loaded: DatabaseResult;
  try {
    loaded = await dependencies.loadCore(token, requested);
    if (!loaded.error && record(loaded.data) && loaded.data.reason === "IDENTITY_UNMAPPED") loaded = await dependencies.loadCore(token, requested);
  } catch { return { ok: false, response: json({ ok: false, reason: "DATABASE_UNAVAILABLE" }, 503) }; }
  if (loaded.error) return { ok: false, response: json({ ok: false, reason: "DATABASE_UNAVAILABLE" }, 503) };
  if (!record(loaded.data)) return { ok: false, response: json({ ok: false, reason: "INVALID_CORE_RESPONSE" }, 503) };
  if (loaded.data.ok !== true) {
    const reason = string(loaded.data.reason) ? loaded.data.reason : "POS_CONTEXT_UNAVAILABLE";
    return { ok: false, response: json({ ok: false, reason }, reason === "IDENTITY_UNMAPPED" ? 401 : 403) };
  }
  if (!core(loaded.data)) return { ok: false, response: json({ ok: false, reason: "INVALID_BUSINESS_CONTEXT" }, 503) };
  if (loaded.data.organization.status !== "active") return { ok: false, response: json({ ok: false, reason: "ORGANIZATION_INACTIVE" }, 403) };
  if (!BUSINESS_TYPES.has(loaded.data.organization.businessType)) return { ok: false, response: json({ ok: false, reason: "INVALID_BUSINESS_TYPE" }, 503) };
  return { ok: true, token, core: loaded.data };
}

export async function handleOwnedStockOperation(
  request: Request,
  action: StockOperationAction,
  dependencies: OwnedStockOperationsDependencies,
): Promise<Response> {
  const context = await loadContext(request, dependencies);
  if (!context.ok) return context.response;
  const compatibilityContext = {
    permissions: context.core.permissions,
    assignedStoreIds: context.core.storeIds,
    inventoryEnabled: context.core.features.inventory === true,
  };

  let stockRequestId = "";
  if (action === "receive-request") {
    const pathValidation = validateStockRequestReceiptId(stockRequestIdFromReceiptPath(new URL(request.url).pathname));
    if (!pathValidation.ok) return json(pathValidation.result, pathValidation.status);
    stockRequestId = pathValidation.stockRequestId;
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ ok: false, message: "The request data is invalid." }, 400); }

  if (action === "validate-cart") {
    const validation = validateCartStockOperation(body, compatibilityContext);
    if (!validation.ok) return json(validation.result);
    try {
      const answer = await dependencies.validateCart(context.token, context.core.organization.id, validation.input);
      return json(mapCartStockValidationResult(answer.data, databaseError(answer.error)));
    } catch { return json(mapCartStockValidationResult(null, null)); }
  }

  const validation = validateStockRequestReceipt(stockRequestId, body, compatibilityContext);
  if (!validation.ok) return json(validation.result);
  try {
    const answer = await dependencies.receiveRequest(context.token, context.core.organization.id, validation.input);
    return json(mapStockRequestReceiptResult(string(answer.data) ? answer.data : null, databaseError(answer.error)));
  } catch { return json(mapStockRequestReceiptResult(null, null)); }
}

export const STOCK_OPERATION_RPCS = {
  validateCart: POS_CART_STOCK_VALIDATION_RPC,
  receiveRequest: POS_STOCK_REQUEST_RECEIPT_RPC,
} as const;

export const stockOperationRpcArguments = {
  validateCart: toCartStockValidationRpcArguments,
  receiveRequest: toStockRequestReceiptRpcArguments,
} as const;
