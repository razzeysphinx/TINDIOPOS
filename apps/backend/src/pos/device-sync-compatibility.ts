import {
  POS_DEVICE_ACCESS_MESSAGE,
  POS_DEVICE_ACCESS_PERMISSION,
  POS_DEVICE_ENROLLMENT_CONFIRMATION_MESSAGE,
  POS_DEVICE_ENROLLMENT_DUPLICATE_MESSAGE,
  POS_DEVICE_ENROLLMENT_INVALID_MESSAGE,
  POS_DEVICE_ENROLLMENT_PATH,
  POS_DEVICE_ENROLLMENT_PERMISSION_MESSAGE,
  POS_DEVICE_ENROLLMENT_RPC,
  POS_DEVICE_ENROLLMENT_SCOPE_MESSAGE,
  POS_DEVICE_ENROLLMENT_UNAVAILABLE_MESSAGE,
  POS_DEVICE_INVALID_MESSAGE,
  POS_DEVICE_MANAGEMENT_MESSAGE,
  POS_DEVICE_MANAGEMENT_PERMISSION,
  POS_DEVICE_REJECTED_MESSAGE,
  POS_DEVICE_UNAVAILABLE_MESSAGE,
  POS_DEVICE_VALIDATION_PATH,
  POS_DEVICE_VALIDATION_RPC,
  posDeviceValidationSchema,
  registerPosDeviceSchema,
  type PosDeviceBinding,
} from "@tindio/contracts/device";
import {
  POS_SYNC_BASELINE_INVALID_MESSAGE,
  POS_SYNC_BASELINE_PATH,
  POS_SYNC_BASELINE_UNAVAILABLE_MESSAGE,
  POS_SYNC_CATALOG_RPC,
  POS_SYNC_CHANGE_WINDOW_RPC,
  POS_SYNC_CHECKPOINT_DEVICE_REJECTED_MESSAGE,
  POS_SYNC_CHECKPOINT_INVALID_MESSAGE,
  POS_SYNC_CHECKPOINT_PATH,
  POS_SYNC_CHECKPOINT_RPC,
  POS_SYNC_CHECKPOINT_UNAVAILABLE_MESSAGE,
  POS_SYNC_CUSTOMER_RPC,
  POS_SYNC_DEVICE_REJECTED_MESSAGE,
  POS_SYNC_DEVICE_RPC,
  POS_SYNC_PULL_DEFAULT_LIMIT,
  POS_SYNC_PULL_INVALID_MESSAGE,
  POS_SYNC_PULL_MAX_LIMIT,
  POS_SYNC_PULL_PATH,
  POS_SYNC_PULL_UNAVAILABLE_MESSAGE,
  POS_SYNC_REFERENCE_RPC,
  POS_SYNC_RESNAPSHOT_INVALID_MESSAGE,
  POS_SYNC_RESNAPSHOT_PATH,
  POS_SYNC_RESNAPSHOT_RPC,
  POS_SYNC_RESNAPSHOT_UNAVAILABLE_MESSAGE,
  POS_SYNC_RETENTION_RPC,
  POS_SYNC_REVISION_RPC,
  POS_SYNC_TELEMETRY_INVALID_MESSAGE,
  POS_SYNC_TELEMETRY_PATH,
  POS_SYNC_TELEMETRY_RPC,
  POS_SYNC_TELEMETRY_UNAVAILABLE_MESSAGE,
  POS_SYNC_VERSION,
  posSyncDeviceRequestSchema,
  posSyncPullRequestSchema,
  posSyncTelemetryRequestSchema,
  type PosSyncCursorExpiredResponse,
  type PosSyncDeviceRequest,
  type PosSyncResnapshotResponse,
  type PosSyncTelemetryRequest,
} from "@tindio/contracts/sync-control";

export const DEVICE_SYNC_COMPATIBILITY_CONTRACT = {
  authority: "next-route-handlers",
  method: "POST",
  authentication: "supabase-business-context-before-json",
  organizationScope: "selected-header-or-authorized-default",
  headers: { "cache-control": "private, no-store" },
  device: {
    validation: { path: POS_DEVICE_VALIDATION_PATH, permission: POS_DEVICE_ACCESS_PERMISSION, rpc: POS_DEVICE_VALIDATION_RPC },
    enrollment: { path: POS_DEVICE_ENROLLMENT_PATH, permission: POS_DEVICE_MANAGEMENT_PERMISSION, rpc: POS_DEVICE_ENROLLMENT_RPC },
  },
  sync: {
    baseline: { path: POS_SYNC_BASELINE_PATH, rpc: POS_SYNC_REVISION_RPC },
    checkpoint: { path: POS_SYNC_CHECKPOINT_PATH, rpc: POS_SYNC_CHECKPOINT_RPC },
    pull: { path: POS_SYNC_PULL_PATH, defaultLimit: POS_SYNC_PULL_DEFAULT_LIMIT, maximumLimit: POS_SYNC_PULL_MAX_LIMIT },
    resnapshot: { path: POS_SYNC_RESNAPSHOT_PATH, rpc: POS_SYNC_RESNAPSHOT_RPC },
    telemetry: { path: POS_SYNC_TELEMETRY_PATH, rpc: POS_SYNC_TELEMETRY_RPC },
    deviceRpc: POS_SYNC_DEVICE_RPC,
    pullRpcs: [POS_SYNC_RETENTION_RPC, POS_SYNC_CHANGE_WINDOW_RPC, POS_SYNC_CATALOG_RPC, POS_SYNC_CUSTOMER_RPC, POS_SYNC_REFERENCE_RPC],
    version: POS_SYNC_VERSION,
  },
  custody: ["organization", "employee", "device", "store", "register"],
  retainedAuthority: ["device-status", "sequence-checkpoint", "retention-cursor", "resnapshot-scope", "telemetry-heartbeat"],
} as const;

type Permissions = { permissions: readonly string[] };
type Rejection = { ok: false; status: 400 | 403 | 409 | 503; body: { ok: false; message: string } };
type DatabaseError = { code?: string; message?: string } | null;

const rejection = (status: Rejection["status"], message: string): Rejection => ({ ok: false, status, body: { ok: false, message } });

export function validateDeviceRequest(value: unknown, organizationId: string, context: Permissions) {
  if (!context.permissions.includes(POS_DEVICE_ACCESS_PERMISSION)) return rejection(403, POS_DEVICE_ACCESS_MESSAGE);
  const parsed = posDeviceValidationSchema.safeParse(value);
  return !parsed.success || parsed.data.organizationId !== organizationId
    ? rejection(400, POS_DEVICE_INVALID_MESSAGE)
    : { ok: true as const, input: parsed.data };
}

export function toDeviceValidationRpcArguments(organizationId: string, input: PosSyncDeviceRequest) {
  return { target_organization_id: organizationId, target_device_id: input.device.deviceId, target_secret: input.device.secret, target_app_version: input.device.appVersion };
}

export function mapDeviceValidationResult(data: Array<Record<string, unknown>> | null, error: DatabaseError) {
  const row = data?.[0];
  if (error || !row) return rejection(403, POS_DEVICE_REJECTED_MESSAGE);
  return { ok: true as const, status: 200 as const, body: { ok: true as const, device: {
    deviceId: String(row.device_id), storeId: String(row.store_id), registerId: String(row.register_id),
    deviceName: String(row.device_name), appVersion: String(row.app_version), lastSeenAt: String(row.last_seen_at),
  } satisfies PosDeviceBinding } };
}

export function validateDeviceEnrollment(value: unknown, context: Permissions) {
  if (!context.permissions.includes(POS_DEVICE_MANAGEMENT_PERMISSION)) return rejection(403, POS_DEVICE_MANAGEMENT_MESSAGE);
  const parsed = registerPosDeviceSchema.safeParse(value);
  return parsed.success ? { ok: true as const, input: parsed.data } : rejection(400, POS_DEVICE_ENROLLMENT_INVALID_MESSAGE);
}

export function toDeviceEnrollmentRpcArguments(organizationId: string, input: ReturnType<typeof registerPosDeviceSchema.parse>) {
  return {
    target_organization_id: organizationId, target_store_id: input.storeId, target_register_id: input.registerId,
    target_device_id: input.deviceId, target_name: input.name, target_app_version: input.appVersion, target_secret: input.secret,
  };
}

export function mapDeviceEnrollmentResult(input: ReturnType<typeof registerPosDeviceSchema.parse>, data: Array<Record<string, unknown>> | null, error: DatabaseError) {
  if (error) {
    if (error.code === "42501") return rejection(403, POS_DEVICE_ENROLLMENT_PERMISSION_MESSAGE);
    if (error.code === "23514") return rejection(400, POS_DEVICE_ENROLLMENT_SCOPE_MESSAGE);
    if (error.code === "23505") return rejection(409, POS_DEVICE_ENROLLMENT_DUPLICATE_MESSAGE);
    return rejection(503, POS_DEVICE_ENROLLMENT_UNAVAILABLE_MESSAGE);
  }
  const row = data?.[0];
  const lastSeenAt = typeof row?.last_seen_at === "string" ? row.last_seen_at : null;
  if (!row || !lastSeenAt) return rejection(503, POS_DEVICE_ENROLLMENT_CONFIRMATION_MESSAGE);
  return { ok: true as const, status: 200 as const, body: { ok: true as const, device: {
    deviceId: input.deviceId, storeId: input.storeId, registerId: input.registerId,
    deviceName: input.name, appVersion: input.appVersion, lastSeenAt,
  } satisfies PosDeviceBinding } };
}

export function validateSyncDeviceRequest(value: unknown, invalidMessage: string) {
  const parsed = posSyncDeviceRequestSchema.safeParse(value);
  return parsed.success ? { ok: true as const, input: parsed.data } : rejection(400, invalidMessage);
}

export function validateSyncPullRequest(value: unknown) {
  const parsed = posSyncPullRequestSchema.safeParse(value);
  return parsed.success ? { ok: true as const, input: parsed.data } : rejection(400, POS_SYNC_PULL_INVALID_MESSAGE);
}

export function mapValidatedSyncDevice(data: unknown, error: unknown, input: PosSyncDeviceRequest) {
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row || typeof row !== "object" || Array.isArray(row) || String(row.device_id) !== input.device.deviceId) return null;
  return {
    deviceId: input.device.deviceId, storeId: String(row.store_id), registerId: String(row.register_id),
    deviceName: String(row.name ?? "POS device"), appVersion: String(row.app_version ?? input.device.appVersion),
    lastSeenAt: row.last_seen_at ? String(row.last_seen_at) : null, status: String(row.status ?? "active"),
  };
}

export function mapSyncRevision(value: unknown) {
  const revision = Number(Array.isArray(value) ? value[0]?.current_revision : undefined);
  return Number.isSafeInteger(revision) ? revision : null;
}

export function mapSyncCheckpoint(value: unknown) {
  const row = Array.isArray(value) ? value[0] : null;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const serverCheckpoint = Number(row.server_checkpoint);
  const nextExpectedSequence = Number(row.next_expected_sequence);
  if (!Number.isSafeInteger(serverCheckpoint) || !Number.isSafeInteger(nextExpectedSequence)) return null;
  return { deviceId: String(row.device_id), serverCheckpoint, nextExpectedSequence, updatedAt: row.updated_at ? String(row.updated_at) : null };
}

export function mapSyncRetention(value: unknown) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const retainedAfterRevision = Number(row.retained_after_revision);
  const serverRevision = Number(row.current_revision);
  return Number.isSafeInteger(retainedAfterRevision) && Number.isSafeInteger(serverRevision) ? { retainedAfterRevision, serverRevision } : null;
}

export function createSyncCursorExpiredResponse(scope: { organizationId: string; deviceId: string; storeId: string }, cursor: number, retention: { retainedAfterRevision: number; serverRevision: number }): PosSyncCursorExpiredResponse {
  return { ok: false, version: POS_SYNC_VERSION, ...scope, fromCursor: cursor, ...retention, code: "SYNC_CURSOR_EXPIRED" };
}

export function validateSyncResnapshot(value: unknown, scope: { organizationId: string; deviceId: string; storeId: string }): PosSyncResnapshotResponse | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const snapshot = row as Record<string, unknown>;
  const serverRevision = Number(snapshot.serverRevision);
  const retainedAfterRevision = Number(snapshot.retainedAfterRevision);
  const reference = snapshot.reference as { organizationId?: unknown } | null;
  if (snapshot.organizationId !== scope.organizationId || snapshot.deviceId !== scope.deviceId || snapshot.storeId !== scope.storeId
    || !Number.isSafeInteger(serverRevision) || !Number.isSafeInteger(retainedAfterRevision) || serverRevision < retainedAfterRevision
    || !Array.isArray(snapshot.catalog) || !reference || reference.organizationId !== scope.organizationId) return null;
  return { ...(snapshot as Omit<PosSyncResnapshotResponse, "ok" | "version" | "serverRevision" | "retainedAfterRevision" | "clearObservedCustomers" | "invalidateModifiers">), ok: true, version: POS_SYNC_VERSION, serverRevision, retainedAfterRevision, clearObservedCustomers: true, invalidateModifiers: true };
}

export function validateSyncTelemetry(value: unknown, organizationId: string, employeeId: string) {
  const parsed = posSyncTelemetryRequestSchema.safeParse(value);
  return !parsed.success || parsed.data.organizationId !== organizationId || parsed.data.employeeId !== employeeId
    ? rejection(400, POS_SYNC_TELEMETRY_INVALID_MESSAGE)
    : { ok: true as const, input: parsed.data };
}

export function toSyncTelemetryRpcArguments(organizationId: string, employeeId: string, device: { deviceId: string; storeId: string; registerId: string; appVersion: string }, input: PosSyncTelemetryRequest) {
  return {
    target_organization_id: organizationId, target_device_id: device.deviceId, target_store_id: device.storeId,
    target_register_id: device.registerId, target_employee_id: employeeId, target_employee_name: input.employeeName,
    target_connection_mode: input.connectionMode, target_app_version: device.appVersion,
    target_last_successful_sync_at: input.lastSuccessfulSyncAt, target_device_checkpoint: input.deviceCheckpoint,
    target_server_checkpoint: input.serverCheckpoint, target_queue_depth: input.queueDepth,
    target_conflict_count: input.conflictCount, target_failed_count: input.failedCount, target_offline_since: input.offlineSince,
    target_crash_count: input.crashCount, target_crash_window_started_at: input.crashWindowStartedAt,
    target_last_crash_at: input.lastCrashAt, target_anr_count: input.anrCount, target_last_anr_at: input.lastAnrAt,
    target_api_average_latency_ms: input.apiAverageLatencyMs, target_api_max_latency_ms: input.apiMaxLatencyMs,
    target_api_failure_count: input.apiFailureCount, target_sync_average_latency_ms: input.syncAverageLatencyMs,
    target_sync_max_latency_ms: input.syncMaxLatencyMs, target_local_database_health: input.localDatabaseHealth,
    target_local_schema_version: input.localSchemaVersion,
  };
}

export const DEVICE_SYNC_MESSAGES = {
  deviceUnavailable: POS_DEVICE_UNAVAILABLE_MESSAGE,
  baselineInvalid: POS_SYNC_BASELINE_INVALID_MESSAGE, baselineUnavailable: POS_SYNC_BASELINE_UNAVAILABLE_MESSAGE,
  checkpointInvalid: POS_SYNC_CHECKPOINT_INVALID_MESSAGE, checkpointRejected: POS_SYNC_CHECKPOINT_DEVICE_REJECTED_MESSAGE,
  checkpointUnavailable: POS_SYNC_CHECKPOINT_UNAVAILABLE_MESSAGE, deviceRejected: POS_SYNC_DEVICE_REJECTED_MESSAGE,
  pullUnavailable: POS_SYNC_PULL_UNAVAILABLE_MESSAGE, resnapshotInvalid: POS_SYNC_RESNAPSHOT_INVALID_MESSAGE,
  resnapshotUnavailable: POS_SYNC_RESNAPSHOT_UNAVAILABLE_MESSAGE, telemetryUnavailable: POS_SYNC_TELEMETRY_UNAVAILABLE_MESSAGE,
} as const;
