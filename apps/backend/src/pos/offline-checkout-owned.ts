import {
  POS_OFFLINE_CHECKOUT_INVALID_MESSAGE,
  POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE,
} from "@tindio/contracts/offline-checkout";
import {
  checkoutSubmissionSchema,
  type CheckoutDeviceCredential,
  type CheckoutSaleActionResult,
  type CheckoutSaleValues,
  type CheckoutSequenceInfo,
} from "@tindio/contracts/checkout";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  mapCheckoutRpcResult,
  type CheckoutRpcRow,
} from "./checkout-compatibility.js";
import {
  mapOfflineSequenceFinalization,
  mapOfflineSequenceReservation,
  offlineCheckoutFailureCode,
  offlineCheckoutResponseStatus,
  offlineSequenceFinalState,
  offlineSequenceIntent,
  shouldRecordOfflineOutcome,
  validateOfflineCheckout,
  validateOfflineDeviceBinding,
  validateOfflinePaymentMethod,
  type OfflineSequenceIntent,
} from "./offline-checkout-compatibility.js";

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
type RequiredSequenceIntent = Extract<OfflineSequenceIntent, { kind: "required" }>;

export type OwnedOfflineCheckoutDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  validateDevice: (
    token: string,
    organizationId: string,
    intent: RequiredSequenceIntent,
  ) => Promise<DatabaseResult>;
  reserveSequence: (
    token: string,
    organizationId: string,
    intent: RequiredSequenceIntent,
  ) => Promise<DatabaseResult>;
  loadPaymentMethod: (
    token: string,
    organizationId: string,
    paymentMethodId: string,
    device: CheckoutDeviceCredential | null | undefined,
  ) => Promise<DatabaseResult>;
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
  finalizeSequence: (
    token: string,
    organizationId: string,
    intent: RequiredSequenceIntent,
    finalState: "APPLIED" | "CONFLICT",
  ) => Promise<DatabaseResult>;
  recordOutcome: (
    token: string,
    organizationId: string,
    body: unknown,
    result: CheckoutSaleActionResult,
    device: CheckoutDeviceCredential | null | undefined,
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
    message: POS_OFFLINE_CHECKOUT_UNCONFIRMED_MESSAGE,
    retryable: true,
  }, 503);
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

function bodyDevice(body: unknown): CheckoutDeviceCredential | null | undefined {
  const parsed = checkoutSubmissionSchema.safeParse(body);
  return parsed.success ? parsed.data.device : undefined;
}

async function completeTerminalOutcome({
  body,
  dependencies,
  intent,
  organizationId,
  result,
  sync,
  token,
}: {
  body: unknown;
  dependencies: OwnedOfflineCheckoutDependencies;
  intent: RequiredSequenceIntent | null;
  organizationId: string;
  result: CheckoutSaleActionResult;
  sync: CheckoutSequenceInfo | null;
  token: string;
}): Promise<Response> {
  if (!result.ok && result.retryable) {
    return jsonResponse(result, offlineCheckoutResponseStatus(result));
  }

  let sequenced = result;
  if (intent && sync) {
    const finalState = offlineSequenceFinalState(result);
    if (finalState) {
      const finalized = await dependencies.finalizeSequence(
        token,
        organizationId,
        intent,
        finalState,
      );
      const mapped = mapOfflineSequenceFinalization(sync, finalized.data, finalized.error);
      if ("ok" in mapped) return jsonResponse(mapped, 503);
      sequenced = { ...result, sync: mapped };
    }
  }

  if (shouldRecordOfflineOutcome(body, sequenced)) {
    await dependencies.recordOutcome(
      token,
      organizationId,
      body,
      sequenced,
      bodyDevice(body),
    );
  }
  return jsonResponse(sequenced, offlineCheckoutResponseStatus(sequenced));
}

export async function handleOwnedOfflineCheckout(
  request: Request,
  dependencies: OwnedOfflineCheckoutDependencies,
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({
      ok: false,
      message: POS_OFFLINE_CHECKOUT_INVALID_MESSAGE,
      retryable: false,
    }, 400);
  }

  try {
    const sequenceIntent = offlineSequenceIntent(body);
    if (sequenceIntent.kind === "rejected") {
      return await completeTerminalOutcome({
        body,
        dependencies,
        intent: null,
        organizationId: core.organization.id,
        result: sequenceIntent.result,
        sync: null,
        token,
      });
    }

    const requiredIntent = sequenceIntent.kind === "required" ? sequenceIntent : null;
    let sync: CheckoutSequenceInfo | null = null;
    if (requiredIntent) {
      const deviceResult = await dependencies.validateDevice(
        token,
        core.organization.id,
        requiredIntent,
      );
      const deviceFailure = validateOfflineDeviceBinding(
        deviceResult.data,
        deviceResult.error,
        requiredIntent,
      );
      if (deviceFailure) {
        const response = await completeTerminalOutcome({
          body,
          dependencies,
          intent: null,
          organizationId: core.organization.id,
          result: deviceFailure,
          sync: null,
          token,
        });
        return new Response(response.body, { status: 403, headers: response.headers });
      }

      const reserveResult = await dependencies.reserveSequence(
        token,
        core.organization.id,
        requiredIntent,
      );
      const reservation = mapOfflineSequenceReservation(
        reserveResult.data,
        reserveResult.error,
        requiredIntent.offline.deviceSequence,
      );
      if (reservation.kind !== "reserved") {
        if (reservation.kind === "retryable") {
          return jsonResponse(reservation.result, reservation.status);
        }
        return await completeTerminalOutcome({
          body,
          dependencies,
          intent: null,
          organizationId: core.organization.id,
          result: reservation.result,
          sync: null,
          token,
        });
      }
      sync = reservation.sync;
    }

    const validation = validateOfflineCheckout(body, {
      permissions: core.permissions,
      assignedStoreIds: core.storeIds,
    });
    if (!validation.ok) {
      return await completeTerminalOutcome({
        body,
        dependencies,
        intent: requiredIntent,
        organizationId: core.organization.id,
        result: validation.result,
        sync,
        token,
      });
    }

    const paymentMethod = await dependencies.loadPaymentMethod(
      token,
      core.organization.id,
      validation.input.payments[0]!.paymentMethodId,
      validation.device,
    );
    const paymentFailure = validateOfflinePaymentMethod(
      paymentMethod.data,
      paymentMethod.error,
    );
    if (paymentFailure) {
      return await completeTerminalOutcome({
        body,
        dependencies,
        intent: requiredIntent,
        organizationId: core.organization.id,
        result: paymentFailure,
        sync,
        token,
      });
    }

    const checkoutResult = await dependencies.checkout(
      token,
      core.organization.id,
      validation.input,
      validation.device,
    );
    const row = checkoutRow(checkoutResult.data);
    const error = rpcError(checkoutResult.error);
    let result: CheckoutSaleActionResult;
    if (error || !row) {
      const mapped = mapCheckoutRpcResult(null, error);
      result = !mapped.ok && error?.code !== "40001" && error
        ? { ...mapped, failureCode: offlineCheckoutFailureCode(error.code, error.message) }
        : mapped;
    } else {
      const stockResult = await dependencies.loadStockWarning(
        token,
        core.organization.id,
        validation.input.storeId,
        row.sale_id,
      );
      const negativeStockItemCount = typeof stockResult.data === "number"
        ? stockResult.data
        : null;
      result = mapCheckoutRpcResult(row, null, negativeStockItemCount);
    }

    return await completeTerminalOutcome({
      body,
      dependencies,
      intent: requiredIntent,
      organizationId: core.organization.id,
      result,
      sync,
      token,
    });
  } catch {
    return unconfirmedResponse();
  }
}
