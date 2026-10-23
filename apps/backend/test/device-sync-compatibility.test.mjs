import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_SYNC_COMPATIBILITY_CONTRACT,
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
} from "../dist/src/pos/device-sync-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const DEVICE_ID = "10000000-0000-4000-8000-000000000001";
const STORE_ID = "20000000-0000-4000-8000-000000000001";
const REGISTER_ID = "30000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "40000000-0000-4000-8000-000000000001";
const DEVICE = { deviceId: DEVICE_ID, secret: "a".repeat(64), appVersion: "mobile-1.0.0" };
const DEVICE_REQUEST = { organizationId: ORGANIZATION_ID, device: DEVICE };
const ENROLLMENT = { storeId: STORE_ID, registerId: REGISTER_ID, deviceId: DEVICE_ID, name: "Counter 1", appVersion: "mobile-1.0.0", secret: "b".repeat(64) };

test("device and sync compatibility freezes all seven Web-owned routes", () => {
  assert.deepEqual(DEVICE_SYNC_COMPATIBILITY_CONTRACT.device, {
    validation: { path: "/api/pos/v2/device", permission: "pos.access", rpc: "validate_pos_device" },
    enrollment: { path: "/api/pos/v2/device/enroll", permission: "devices.manage", rpc: "register_pos_device" },
  });
  assert.deepEqual(Object.values(DEVICE_SYNC_COMPATIBILITY_CONTRACT.sync).filter((value) => value?.path).map((value) => value.path), [
    "/api/pos/v2/sync/baseline", "/api/pos/v2/sync/checkpoint", "/api/pos/v2/sync/pull",
    "/api/pos/v2/sync/resnapshot", "/api/pos/v2/sync/telemetry",
  ]);
  assert.deepEqual(DEVICE_SYNC_COMPATIBILITY_CONTRACT.custody, ["organization", "employee", "device", "store", "register"]);
});

test("device validation preserves permission-before-input and organization custody", () => {
  assert.deepEqual(validateDeviceRequest(null, ORGANIZATION_ID, { permissions: [] }), {
    ok: false, status: 403, body: { ok: false, message: "POS access is not permitted." },
  });
  assert.equal(validateDeviceRequest(DEVICE_REQUEST, ORGANIZATION_ID, { permissions: ["pos.access"] }).ok, true);
  assert.deepEqual(validateDeviceRequest({ ...DEVICE_REQUEST, organizationId: STORE_ID }, ORGANIZATION_ID, { permissions: ["pos.access"] }), {
    ok: false, status: 400, body: { ok: false, message: "The POS device request is invalid." },
  });
});

test("device validation maps exact RPC arguments and response projection", () => {
  assert.deepEqual(toDeviceValidationRpcArguments(ORGANIZATION_ID, DEVICE_REQUEST), {
    target_organization_id: ORGANIZATION_ID, target_device_id: DEVICE_ID,
    target_secret: "a".repeat(64), target_app_version: "mobile-1.0.0",
  });
  const row = [{ device_id: DEVICE_ID, store_id: STORE_ID, register_id: REGISTER_ID, device_name: "Counter 1", app_version: "mobile-1.0.0", last_seen_at: "2026-10-23T08:00:00.000Z" }];
  assert.deepEqual(mapDeviceValidationResult(row, null).body.device, {
    deviceId: DEVICE_ID, storeId: STORE_ID, registerId: REGISTER_ID, deviceName: "Counter 1",
    appVersion: "mobile-1.0.0", lastSeenAt: "2026-10-23T08:00:00.000Z",
  });
  assert.equal(mapDeviceValidationResult(null, null).status, 403);
});

test("device enrollment freezes permission, bounds, errors, and success identity", () => {
  assert.equal(validateDeviceEnrollment(null, { permissions: [] }).status, 403);
  const parsed = validateDeviceEnrollment({ ...ENROLLMENT, name: "  Counter 1  ", ignored: true }, { permissions: ["devices.manage"] });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.input, ENROLLMENT);
  assert.deepEqual(toDeviceEnrollmentRpcArguments(ORGANIZATION_ID, parsed.input), {
    target_organization_id: ORGANIZATION_ID, target_store_id: STORE_ID, target_register_id: REGISTER_ID,
    target_device_id: DEVICE_ID, target_name: "Counter 1", target_app_version: "mobile-1.0.0", target_secret: "b".repeat(64),
  });
  assert.equal(mapDeviceEnrollmentResult(parsed.input, null, { code: "42501" }).status, 403);
  assert.equal(mapDeviceEnrollmentResult(parsed.input, null, { code: "23514" }).status, 400);
  assert.equal(mapDeviceEnrollmentResult(parsed.input, null, { code: "23505" }).status, 409);
  assert.equal(mapDeviceEnrollmentResult(parsed.input, [{}], null).status, 503);
  assert.equal(mapDeviceEnrollmentResult(parsed.input, [{ last_seen_at: "2026-10-23T08:00:00.000Z" }], null).body.device.deviceId, DEVICE_ID);
});

test("sync device and pull schemas retain credentials, cursor, and limits", () => {
  assert.equal(validateSyncDeviceRequest(DEVICE_REQUEST, "invalid").ok, true);
  assert.equal(validateSyncDeviceRequest(null, "invalid").status, 400);
  assert.equal(validateSyncPullRequest({ ...DEVICE_REQUEST, cursor: 0 }).ok, true);
  assert.equal(validateSyncPullRequest({ ...DEVICE_REQUEST, cursor: 0, limit: 200 }).ok, true);
  assert.equal(validateSyncPullRequest({ ...DEVICE_REQUEST, cursor: -1 }).status, 400);
  assert.equal(validateSyncPullRequest({ ...DEVICE_REQUEST, cursor: 0, limit: 201 }).status, 400);
});

test("validated sync device binds the expected device and server-owned scope", () => {
  const row = [{ device_id: DEVICE_ID, store_id: STORE_ID, register_id: REGISTER_ID, name: "Counter 1", status: "active" }];
  assert.deepEqual(mapValidatedSyncDevice(row, null, DEVICE_REQUEST), {
    deviceId: DEVICE_ID, storeId: STORE_ID, registerId: REGISTER_ID, deviceName: "Counter 1",
    appVersion: "mobile-1.0.0", lastSeenAt: null, status: "active",
  });
  assert.equal(mapValidatedSyncDevice(row, null, { ...DEVICE_REQUEST, device: { ...DEVICE, deviceId: STORE_ID } }), null);
});

test("baseline, checkpoint, and retention accept only safe integer revisions", () => {
  assert.equal(mapSyncRevision([{ current_revision: "42" }]), 42);
  assert.equal(mapSyncRevision([{ current_revision: "invalid" }]), null);
  assert.deepEqual(mapSyncCheckpoint([{ device_id: DEVICE_ID, server_checkpoint: "8", next_expected_sequence: "9", updated_at: null }]), {
    deviceId: DEVICE_ID, serverCheckpoint: 8, nextExpectedSequence: 9, updatedAt: null,
  });
  assert.equal(mapSyncCheckpoint([{ device_id: DEVICE_ID, server_checkpoint: "bad", next_expected_sequence: 9 }]), null);
  assert.deepEqual(mapSyncRetention({ retained_after_revision: "10", current_revision: "20" }), { retainedAfterRevision: 10, serverRevision: 20 });
});

test("expired cursors produce the exact versioned fail-closed response", () => {
  assert.deepEqual(createSyncCursorExpiredResponse({ organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID, storeId: STORE_ID }, 9, { retainedAfterRevision: 10, serverRevision: 20 }), {
    ok: false, version: 1, organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID, storeId: STORE_ID,
    fromCursor: 9, retainedAfterRevision: 10, serverRevision: 20, code: "SYNC_CURSOR_EXPIRED",
  });
});

test("resnapshot requires exact organization, device, store, revision, and reference scope", () => {
  const snapshot = { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID, storeId: STORE_ID, serverRevision: "20", retainedAfterRevision: "10", catalog: [], reference: { organizationId: ORGANIZATION_ID } };
  assert.deepEqual(validateSyncResnapshot(snapshot, { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID, storeId: STORE_ID }), {
    ...snapshot, ok: true, version: 1, serverRevision: 20, retainedAfterRevision: 10, clearObservedCustomers: true, invalidateModifiers: true,
  });
  assert.equal(validateSyncResnapshot({ ...snapshot, storeId: REGISTER_ID }, { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID, storeId: STORE_ID }), null);
  assert.equal(validateSyncResnapshot({ ...snapshot, serverRevision: 9 }, { organizationId: ORGANIZATION_ID, deviceId: DEVICE_ID, storeId: STORE_ID }), null);
});

test("telemetry applies defaults, employee custody, and exact RPC projection", () => {
  const input = { ...DEVICE_REQUEST, employeeId: EMPLOYEE_ID, employeeName: "  Cashier One  ", connectionMode: "CLOUD_ONLINE", lastSuccessfulSyncAt: null, deviceCheckpoint: 8, serverCheckpoint: 9, queueDepth: 1, conflictCount: 2, failedCount: 3, offlineSince: null };
  const parsed = validateSyncTelemetry(input, ORGANIZATION_ID, EMPLOYEE_ID);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.input.employeeName, "Cashier One");
  assert.equal(parsed.input.crashCount, 0);
  assert.equal(parsed.input.localDatabaseHealth, "UNKNOWN");
  assert.equal(validateSyncTelemetry(input, ORGANIZATION_ID, STORE_ID).status, 400);
  const args = toSyncTelemetryRpcArguments(ORGANIZATION_ID, EMPLOYEE_ID, { deviceId: DEVICE_ID, storeId: STORE_ID, registerId: REGISTER_ID, appVersion: "mobile-1.0.0" }, parsed.input);
  assert.equal(args.target_employee_id, EMPLOYEE_ID);
  assert.equal(args.target_device_checkpoint, 8);
  assert.equal(args.target_local_schema_version, 0);
  assert.equal(args.target_local_database_health, "UNKNOWN");
});
