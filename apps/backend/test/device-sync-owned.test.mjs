import assert from "node:assert/strict";
import test from "node:test";
import { handleOwnedDeviceSync } from "../dist/src/pos/device-sync-owned.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const STORE = "44444444-4444-4444-8444-444444444444";
const REGISTER = "55555555-5555-4555-8555-555555555555";
const DEVICE_ID = "66666666-6666-4666-8666-666666666666";
const TOKEN = "header.payload.signature";
const DEVICE = { deviceId: DEVICE_ID, secret: "a".repeat(64), appVersion: "1.0.0" };
const CORE = {
  ok: true, profileId: PROFILE,
  organization: { id: ORG, name: "Tindio", currencyCode: "PHP", timezone: "Asia/Manila", status: "active", businessType: "retail", deviceManagementEnabled: true },
  employee: { id: EMPLOYEE, employeeNumber: "E1", jobTitle: "Cashier", name: "Cashier" },
  availableOrganizations: [{ id: ORG, name: "Tindio", status: "active" }], roleNames: ["Cashier"],
  permissions: ["pos.access", "devices.manage"], storeIds: [STORE], features: { offline: true },
};
const deviceRow = { device_id: DEVICE_ID, store_id: STORE, register_id: REGISTER, device_name: "Till", name: "Till", app_version: "1.0.0", last_seen_at: "2026-10-23T00:00:00.000Z", status: "active" };

function request(path, value, headers = {}) {
  return new Request(`https://backend.test${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", "x-tindio-organization-id": ORG, ...headers }, body: typeof value === "string" ? value : JSON.stringify(value) });
}
function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: "user" } }, error: null }),
    loadCore: async () => ({ data: CORE, error: null }),
    rpc: async (_token, name) => {
      if (name === "validate_pos_device") return { data: [deviceRow], error: null };
      if (name === "register_pos_device") return { data: [{ last_seen_at: deviceRow.last_seen_at }], error: null };
      if (name === "get_pos_sync_revision") return { data: [{ current_revision: 8 }], error: null };
      if (name === "get_pos_device_sync_checkpoint") return { data: [{ device_id: DEVICE_ID, server_checkpoint: 7, next_expected_sequence: 8, updated_at: null }], error: null };
      if (name === "get_pos_sync_retention_state") return { data: [{ retained_after_revision: 2, current_revision: 8 }], error: null };
      if (name === "get_pos_sync_change_window") return { data: [], error: null };
      if (name === "get_pos_sync_resnapshot_v1") return { data: [{ organizationId: ORG, deviceId: DEVICE_ID, storeId: STORE, serverRevision: 8, retainedAfterRevision: 2, catalog: [], reference: { organizationId: ORG } }], error: null };
      if (name === "report_pos_device_sync_telemetry") return { data: [{ heartbeat_at: "2026-10-23T01:00:00.000Z" }], error: null };
      throw new Error(`unexpected ${name}`);
    },
    ...overrides,
  };
}
const base = { organizationId: ORG, device: DEVICE };

test("owned device-sync authorizes context before malformed JSON", async () => {
  const order = [];
  const response = await handleOwnedDeviceSync(request("/api/pos/v2/device", "bad"), "device", dependencies({
    verifyClaims: async () => { order.push("claims"); return { data: { claims: { sub: "user" } }, error: null }; },
    loadCore: async () => { order.push("context"); return { data: CORE, error: null }; },
  }));
  assert.deepEqual(order, ["claims", "context"]);
  assert.equal(response.status, 400);
});

test("owned device validation and enrollment preserve frozen response contracts", async () => {
  const validated = await handleOwnedDeviceSync(request("/api/pos/v2/device", base), "device", dependencies());
  assert.equal(validated.status, 200);
  assert.equal((await validated.json()).device.deviceId, DEVICE_ID);
  const enrollment = { storeId: STORE, registerId: REGISTER, deviceId: DEVICE_ID, name: "Till", appVersion: "1.0.0", secret: "a".repeat(64) };
  const enrolled = await handleOwnedDeviceSync(request("/api/pos/v2/device/enroll", enrollment), "enroll", dependencies());
  assert.equal(enrolled.status, 200);
  assert.equal((await enrolled.json()).device.lastSeenAt, deviceRow.last_seen_at);
});

test("owned baseline, checkpoint, pull, and resnapshot retain sync custody", async () => {
  const cases = [
    ["baseline", "/api/pos/v2/sync/baseline", base, (value) => assert.equal(value.serverRevision, 8)],
    ["checkpoint", "/api/pos/v2/sync/checkpoint", base, (value) => assert.equal(value.checkpoint.nextExpectedSequence, 8)],
    ["pull", "/api/pos/v2/sync/pull", { ...base, cursor: 2 }, (value) => assert.deepEqual([value.nextCursor, value.hasMore], [2, false])],
    ["resnapshot", "/api/pos/v2/sync/resnapshot", base, (value) => assert.equal(value.clearObservedCustomers, true)],
  ];
  for (const [action, path, input, check] of cases) {
    const response = await handleOwnedDeviceSync(request(path, input), action, dependencies());
    assert.equal(response.status, 200); check(await response.json());
  }
});

test("owned pull expires stale cursors before reading the change window", async () => {
  let windowRead = false;
  const response = await handleOwnedDeviceSync(request("/api/pos/v2/sync/pull", { ...base, cursor: 1 }), "pull", dependencies({
    rpc: async (_token, name) => {
      if (name === "validate_pos_device") return { data: [deviceRow], error: null };
      if (name === "get_pos_sync_retention_state") return { data: [{ retained_after_revision: 2, current_revision: 8 }], error: null };
      windowRead = true; throw new Error("must not run");
    },
  }));
  assert.equal(windowRead, false); assert.equal(response.status, 409); assert.equal((await response.json()).code, "SYNC_CURSOR_EXPIRED");
});

test("owned telemetry validates employee scope and forwards validated device headers", async () => {
  const seen = [];
  const telemetry = { ...base, employeeId: EMPLOYEE, employeeName: "Cashier", connectionMode: "CLOUD_ONLINE", lastSuccessfulSyncAt: null, deviceCheckpoint: 8, serverCheckpoint: 8, queueDepth: 0, conflictCount: 0, failedCount: 0, offlineSince: null };
  const response = await handleOwnedDeviceSync(request("/api/pos/v2/sync/telemetry", telemetry), "telemetry", dependencies({
    rpc: async (_token, name, _args, device) => { seen.push([name, device]); return name === "validate_pos_device" ? { data: [deviceRow], error: null } : { data: [{ heartbeat_at: "2026-10-23T01:00:00.000Z" }], error: null }; },
  }));
  assert.equal(response.status, 200); assert.equal((await response.json()).heartbeatAt, "2026-10-23T01:00:00.000Z");
  assert.deepEqual(seen.map((entry) => entry[1]), [DEVICE, DEVICE]);
});
