import {
  POS_DEVICE_ENROLLMENT_RPC,
  POS_DEVICE_VALIDATION_RPC,
  type PosDeviceCredential,
} from "@tindio/contracts/device";
import {
  POS_SYNC_CATALOG_RPC,
  POS_SYNC_CHANGE_WINDOW_RPC,
  POS_SYNC_CHECKPOINT_RPC,
  POS_SYNC_CUSTOMER_RPC,
  POS_SYNC_DEVICE_RPC,
  POS_SYNC_PULL_DEFAULT_LIMIT,
  POS_SYNC_REFERENCE_RPC,
  POS_SYNC_RESNAPSHOT_RPC,
  POS_SYNC_RETENTION_RPC,
  POS_SYNC_REVISION_RPC,
  POS_SYNC_TELEMETRY_RPC,
  POS_SYNC_VERSION,
  type PosCatalogDelta,
  type PosCustomerDelta,
  type PosSyncDeviceRequest,
  type PosSyncPullRequest,
  type PosSyncPullResponse,
  type PosSyncTelemetryRequest,
} from "@tindio/contracts/sync-control";

import { authErrorStatus, POS_V2_ORGANIZATION_HEADER } from "./bootstrap-owned.js";
import {
  DEVICE_SYNC_MESSAGES,
  createSyncCursorExpiredResponse,
  mapDeviceEnrollmentResult,
  mapDeviceValidationResult,
  mapSyncCheckpoint,
  mapSyncRetention,
  mapSyncRevision,
  mapValidatedSyncDevice,
  toDeviceEnrollmentRpcArguments,
  toDeviceValidationRpcArguments,
  toSyncTelemetryRpcArguments,
  validateDeviceEnrollment,
  validateDeviceRequest,
  validateSyncDeviceRequest,
  validateSyncPullRequest,
  validateSyncResnapshot,
  validateSyncTelemetry,
} from "./device-sync-compatibility.js";

const MAX_TOKEN_LENGTH = 16_384;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUSINESS_TYPES = new Set(["retail", "grocery", "convenience_store", "restaurant_cafe", "bar", "wholesale", "service", "other"]);
const ORGANIZATION_STATUSES = new Set(["active", "suspended", "archived"]);

type ClaimsResult = { data?: { claims?: Record<string, unknown> } | null; error?: unknown };
type DatabaseResult = { data: unknown; error: unknown };
type CoreContext = Record<string, unknown> & {
  organization: Record<string, unknown> & { id: string; status: string; businessType: string };
  employee: Record<string, unknown> & { id: string };
  permissions: string[];
};
type Rpc = (token: string, name: string, args: Record<string, unknown>, device?: PosDeviceCredential | null) => Promise<DatabaseResult>;

export type DeviceSyncAction = "device" | "enroll" | "baseline" | "checkpoint" | "pull" | "resnapshot" | "telemetry";
export type OwnedDeviceSyncDependencies = {
  verifyClaims: (token: string) => Promise<ClaimsResult>;
  loadCore: (token: string, organizationId: string | null) => Promise<DatabaseResult>;
  rpc: Rpc;
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
function dbError(value: unknown): { code?: string; message?: string } | null {
  return record(value) ? { ...(string(value.code) ? { code: value.code } : {}), ...(string(value.message) ? { message: value.message } : {}) } : null;
}
function rpcValue<T>(value: unknown): T | undefined { return (Array.isArray(value) ? value[0] : value) as T | undefined; }

type ContextResult = { ok: true; token: string; core: CoreContext } | { ok: false; response: Response };
async function context(request: Request, dependencies: OwnedDeviceSyncDependencies): Promise<ContextResult> {
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

async function body(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try { return { ok: true, value: await request.json() }; } catch { return { ok: false }; }
}
function deviceArgs(organizationId: string, input: PosSyncDeviceRequest) { return toDeviceValidationRpcArguments(organizationId, input); }
async function checkedDevice(dependencies: OwnedDeviceSyncDependencies, token: string, organizationId: string, input: PosSyncDeviceRequest) {
  const answer = await dependencies.rpc(token, POS_SYNC_DEVICE_RPC, deviceArgs(organizationId, input), input.device);
  return mapValidatedSyncDevice(answer.data, answer.error, input);
}

export async function handleOwnedDeviceSync(request: Request, action: DeviceSyncAction, dependencies: OwnedDeviceSyncDependencies): Promise<Response> {
  const resolved = await context(request, dependencies);
  if (!resolved.ok) return resolved.response;
  const organizationId = resolved.core.organization.id;
  const parsedBody = await body(request);
  if (!parsedBody.ok && action === "enroll") return json({ ok: false, message: "The request data is invalid." }, 400);
  const input = parsedBody.ok ? parsedBody.value : null;

  if (action === "device") {
    const validation = validateDeviceRequest(input, organizationId, resolved.core);
    if (!validation.ok) return json(validation.body, validation.status);
    try {
      const answer = await dependencies.rpc(resolved.token, POS_DEVICE_VALIDATION_RPC, toDeviceValidationRpcArguments(organizationId, validation.input));
      const result = mapDeviceValidationResult(Array.isArray(answer.data) ? answer.data as Array<Record<string, unknown>> : null, dbError(answer.error));
      return json(result.body, result.status);
    } catch { return json({ ok: false, message: DEVICE_SYNC_MESSAGES.deviceUnavailable }, 503); }
  }
  if (action === "enroll") {
    const validation = validateDeviceEnrollment(input, resolved.core);
    if (!validation.ok) return json(validation.body, validation.status);
    try {
      const answer = await dependencies.rpc(resolved.token, POS_DEVICE_ENROLLMENT_RPC, toDeviceEnrollmentRpcArguments(organizationId, validation.input));
      const result = mapDeviceEnrollmentResult(validation.input, Array.isArray(answer.data) ? answer.data as Array<Record<string, unknown>> : null, dbError(answer.error));
      return json(result.body, result.status);
    } catch { return json({ ok: false, message: "TINDIO could not enroll this POS device." }, 503); }
  }

  const invalidMessage = action === "baseline" ? DEVICE_SYNC_MESSAGES.baselineInvalid
    : action === "checkpoint" ? DEVICE_SYNC_MESSAGES.checkpointInvalid
    : action === "resnapshot" ? DEVICE_SYNC_MESSAGES.resnapshotInvalid : "";
  const validation = action === "pull" ? validateSyncPullRequest(input)
    : action === "telemetry" ? validateSyncTelemetry(input, organizationId, resolved.core.employee.id)
    : validateSyncDeviceRequest(input, invalidMessage);
  if (!validation.ok) return json(validation.body, validation.status);
  try {
    const requestInput = validation.input;
    const device = await checkedDevice(dependencies, resolved.token, organizationId, requestInput);
    if (!device) return json({ ok: false, message: action === "checkpoint" ? DEVICE_SYNC_MESSAGES.checkpointRejected : DEVICE_SYNC_MESSAGES.deviceRejected }, 403);
    const scope = { organizationId, deviceId: device.deviceId, storeId: device.storeId };
    if (action === "baseline") {
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_REVISION_RPC, { target_organization_id: organizationId, target_device_id: device.deviceId }, requestInput.device);
      const revision = !answer.error ? mapSyncRevision(answer.data) : null;
      if (revision === null) throw new Error("revision");
      return json({ ok: true, serverRevision: revision, ...scope });
    }
    if (action === "checkpoint") {
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_CHECKPOINT_RPC, { target_organization_id: organizationId, target_device_id: device.deviceId }, requestInput.device);
      const checkpoint = !answer.error ? mapSyncCheckpoint(answer.data) : null;
      if (!checkpoint) throw new Error("checkpoint");
      return json({ ok: true, checkpoint });
    }
    if (action === "resnapshot") {
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_RESNAPSHOT_RPC, { target_organization_id: organizationId, target_device_id: device.deviceId }, requestInput.device);
      const snapshot = !answer.error ? validateSyncResnapshot(answer.data, scope) : null;
      if (!snapshot) throw new Error("resnapshot");
      return json(snapshot);
    }
    if (action === "telemetry") {
      const telemetry = requestInput as PosSyncTelemetryRequest;
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_TELEMETRY_RPC, toSyncTelemetryRpcArguments(organizationId, resolved.core.employee.id, device, telemetry), telemetry.device);
      if (answer.error) throw new Error("telemetry");
      const heartbeat = rpcValue<{ heartbeat_at?: unknown }>(answer.data)?.heartbeat_at;
      return json({ ok: true, deviceId: device.deviceId, heartbeatAt: string(heartbeat) ? heartbeat : new Date().toISOString() });
    }

    const pull = requestInput as PosSyncPullRequest;
    const retentionAnswer = await dependencies.rpc(resolved.token, POS_SYNC_RETENTION_RPC, { target_organization_id: organizationId, target_device_id: device.deviceId }, pull.device);
    const retention = !retentionAnswer.error ? mapSyncRetention(retentionAnswer.data) : null;
    if (!retention) throw new Error("retention");
    if (pull.cursor < retention.retainedAfterRevision) return json(createSyncCursorExpiredResponse(scope, pull.cursor, retention), 409);
    const limit = pull.limit ?? POS_SYNC_PULL_DEFAULT_LIMIT;
    const window = await dependencies.rpc(resolved.token, POS_SYNC_CHANGE_WINDOW_RPC, { target_organization_id: organizationId, target_device_id: device.deviceId, target_after_revision: pull.cursor, target_limit: limit }, pull.device);
    if (window.error || !Array.isArray(window.data)) throw new Error("window");
    type Change = { revision: number; domain: string; entity_id: string | null };
    const raw = window.data.map((row) => ({ ...(record(row) ? row : {}), revision: Number(record(row) ? row.revision : NaN) }) as Change);
    if (raw.some((row) => !Number.isSafeInteger(row.revision))) throw new Error("window");
    const consumed = raw.slice(0, limit);
    const ids = (domain: string) => [...new Set(consumed.filter((row) => row.domain === domain && row.entity_id).map((row) => row.entity_id!))];
    const revision = (domain: string, id?: string) => Math.max(...consumed.filter((row) => row.domain === domain && (!id || row.entity_id === id)).map((row) => row.revision));
    const catalog: PosCatalogDelta[] = [];
    for (const productId of ids("CATALOG")) {
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_CATALOG_RPC, { target_organization_id: organizationId, target_store_id: device.storeId, target_product_id: productId }, pull.device);
      const value = rpcValue<{ items?: PosCatalogDelta["items"] }>(answer.data);
      if (answer.error || !value || !Array.isArray(value.items)) throw new Error("catalog");
      catalog.push({ revision: revision("CATALOG", productId), productId, storeId: device.storeId, items: value.items });
    }
    const customers: PosCustomerDelta[] = [];
    for (const customerId of ids("CUSTOMER")) {
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_CUSTOMER_RPC, { target_organization_id: organizationId, target_device_id: device.deviceId, target_customer_id: customerId }, pull.device);
      const value = rpcValue<{ customer?: PosCustomerDelta["customer"] }>(answer.data);
      if (answer.error || !value) throw new Error("customer");
      customers.push({ revision: revision("CUSTOMER", customerId), customerId, customer: value.customer ?? null });
    }
    const referenceRows = consumed.filter((row) => row.domain === "REFERENCE");
    let reference: PosSyncPullResponse["reference"] = null;
    if (referenceRows.length) {
      const answer = await dependencies.rpc(resolved.token, POS_SYNC_REFERENCE_RPC, { target_organization_id: organizationId }, pull.device);
      const snapshot = rpcValue<NonNullable<PosSyncPullResponse["reference"]>["snapshot"]>(answer.data);
      if (answer.error || !snapshot) throw new Error("reference");
      reference = { revision: revision("REFERENCE"), snapshot };
    }
    const deviceChanged = consumed.some((row) => row.domain === "DEVICE" && row.entity_id === device.deviceId);
    const response: PosSyncPullResponse = {
      ok: true, version: POS_SYNC_VERSION, ...scope, fromCursor: pull.cursor,
      nextCursor: consumed.length ? consumed[consumed.length - 1]!.revision : pull.cursor,
      serverRevision: retention.serverRevision, hasMore: raw.length > limit, catalog, reference, customers,
      device: deviceChanged ? { revision: revision("DEVICE", device.deviceId), ...device } : null,
      invalidateModifiers: consumed.some((row) => row.domain === "MODIFIERS"),
    };
    return json(response);
  } catch {
    const message = action === "baseline" ? DEVICE_SYNC_MESSAGES.baselineUnavailable
      : action === "checkpoint" ? DEVICE_SYNC_MESSAGES.checkpointUnavailable
      : action === "pull" ? DEVICE_SYNC_MESSAGES.pullUnavailable
      : action === "resnapshot" ? DEVICE_SYNC_MESSAGES.resnapshotUnavailable
      : DEVICE_SYNC_MESSAGES.telemetryUnavailable;
    return json({ ok: false, message }, 503);
  }
}
