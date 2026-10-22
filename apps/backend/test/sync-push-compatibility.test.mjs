import assert from "node:assert/strict";
import test from "node:test";

import {
  SYNC_PUSH_COMPATIBILITY_CONTRACT,
  createSyncPushAck,
  createSyncPushResponse,
  mapSyncPushDevice,
  shouldStopSyncPush,
  toSyncPushDeviceRpcArguments,
  toSyncPushOfflineSubmission,
  validateSyncPushBatch,
  validateSyncPushRequest,
} from "../dist/src/pos/sync-push-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const DEVICE_ID = "10000000-0000-4000-8000-000000000001";
const STORE_ID = "20000000-0000-4000-8000-000000000001";
const REGISTER_ID = "30000000-0000-4000-8000-000000000001";
const SHIFT_ID = "40000000-0000-4000-8000-000000000001";

const DEVICE = {
  deviceId: DEVICE_ID,
  secret: "a".repeat(64),
  appVersion: "mobile-1.0.0",
};

function event(sequence, overrides = {}) {
  return {
    eventId: `50000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    operationType: "SALE_COMPLETED",
    checkout: {
      idempotencyKey: `60000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    },
    offline: {
      localReceiptReference: `OFF-ABC12${sequence}`,
      createdAt: "2026-10-22T08:00:00.000Z",
      shiftId: SHIFT_ID,
      deviceId: DEVICE_ID,
      deviceSequence: sequence,
    },
    ...overrides,
  };
}

const REQUEST = {
  organizationId: ORGANIZATION_ID,
  device: DEVICE,
  events: [event(1), event(2)],
};

const SUCCESS = {
  ok: true,
  message: "Sale complete.",
  data: {
    saleId: "70000000-0000-4000-8000-000000000001",
    receiptNumber: 42,
    totalMinor: 1500,
    changeMinor: 500,
    payments: [],
    wasReplayed: false,
    inventoryWarning: null,
  },
};

test("sync push freezes route, custody, ordering, stop, acknowledgement, and response rules", () => {
  assert.deepEqual(SYNC_PUSH_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/sync/push",
    authentication: "supabase-business-context-before-json",
    organizationScope: "selected-header-or-authorized-default",
    requestOrder: "business-context-before-json-before-device-before-events",
    operationType: "SALE_COMPLETED",
    maximumEvents: 20,
    batchIdentity: [
      "one-device",
      "strictly-ascending-positive-device-sequence",
      "unique-event-id",
      "unique-checkout-idempotency-key",
    ],
    deviceRpc: "validate_pos_device",
    deviceCustody: "authenticated-employee-sales-permission-and-assigned-device-store",
    eventProcessor: "frozen-offline-checkout-processor",
    eventOrder: "request-order",
    stopCondition: "first-non-SYNCED-ack",
    ackStatuses: ["SYNCED", "RETRY", "CONFLICT", "FAILED"],
    responseVersion: 1,
    actionResponses: {
      successEnvelope: 200,
      malformedOrInvalidBatch: 400,
      deviceRejected: 403,
      unavailable: 503,
      headers: { "cache-control": "private, no-store" },
    },
    messages: {
      invalid: "Invalid sync push request.",
      invalidBatch: "The sync batch must contain unique ascending events for this device.",
      deviceRejected: "POS device validation failed.",
      unavailable: "TINDIO could not process this sync batch.",
    },
  });
});

test("sync push validates the bounded request envelope", () => {
  const valid = validateSyncPushRequest(REQUEST);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.ok ? valid.input : null, REQUEST);

  const invalid = validateSyncPushRequest({ ...REQUEST, events: [] });
  assert.deepEqual(invalid, {
    ok: false,
    status: 400,
    body: { ok: false, message: "Invalid sync push request." },
  });
  assert.equal(validateSyncPushRequest({ ...REQUEST, events: Array.from({ length: 21 }, (_, i) => event(i + 1)) }).ok, false);
});

test("sync push accepts only ascending unique identities for one device", () => {
  const parsed = validateSyncPushRequest(REQUEST);
  assert.equal(parsed.ok, true);
  assert.equal(validateSyncPushBatch(parsed.input), null);

  const cases = [
    [event(2), event(1)],
    [event(1), { ...event(2), eventId: event(1).eventId }],
    [event(1), { ...event(2), checkout: event(1).checkout }],
    [{ ...event(1), offline: { ...event(1).offline, deviceId: STORE_ID } }],
  ];
  for (const events of cases) {
    const candidate = validateSyncPushRequest({ ...REQUEST, events });
    assert.equal(candidate.ok, true);
    assert.deepEqual(validateSyncPushBatch(candidate.input), {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "The sync batch must contain unique ascending events for this device.",
      },
    });
  }
});

test("sync push preserves missing checkout identity behavior until offline processing", () => {
  const first = validateSyncPushRequest({ ...REQUEST, events: [{ ...event(1), checkout: null }] });
  assert.equal(first.ok, true);
  assert.equal(validateSyncPushBatch(first.input), null);

  const repeated = validateSyncPushRequest({
    ...REQUEST,
    events: [{ ...event(1), checkout: null }, { ...event(2), checkout: null }],
  });
  assert.equal(repeated.ok, true);
  assert.equal(validateSyncPushBatch(repeated.input)?.status, 400);
});

test("sync push projects exact authenticated device validation arguments", () => {
  const parsed = validateSyncPushRequest(REQUEST);
  assert.equal(parsed.ok, true);
  assert.deepEqual(toSyncPushDeviceRpcArguments(ORGANIZATION_ID, parsed.input), {
    target_organization_id: ORGANIZATION_ID,
    target_device_id: DEVICE_ID,
    target_secret: "a".repeat(64),
    target_app_version: "mobile-1.0.0",
  });
});

test("sync push maps only the expected validated device", () => {
  const row = [{
    device_id: DEVICE_ID,
    store_id: STORE_ID,
    register_id: REGISTER_ID,
    name: "Counter 1",
    last_seen_at: "2026-10-22T08:01:00.000Z",
  }];
  assert.deepEqual(mapSyncPushDevice(row, null, DEVICE_ID, DEVICE.appVersion), {
    deviceId: DEVICE_ID,
    storeId: STORE_ID,
    registerId: REGISTER_ID,
    deviceName: "Counter 1",
    appVersion: DEVICE.appVersion,
    lastSeenAt: "2026-10-22T08:01:00.000Z",
    status: "active",
  });
  assert.equal(mapSyncPushDevice(row, null, STORE_ID, DEVICE.appVersion), null);
  assert.equal(mapSyncPushDevice(row, { message: "denied" }, DEVICE_ID, DEVICE.appVersion), null);
});

test("sync push wraps each event for the frozen offline checkout processor", () => {
  const parsed = validateSyncPushRequest(REQUEST);
  assert.equal(parsed.ok, true);
  assert.deepEqual(toSyncPushOfflineSubmission(parsed.input, parsed.input.events[0]), {
    checkout: parsed.input.events[0].checkout,
    device: DEVICE,
    offline: parsed.input.events[0].offline,
  });
});

test("sync push classifies acknowledgements and stops on the first nonsuccess", () => {
  const source = event(1);
  const retry = { ok: false, message: "Retry.", retryable: true };
  const conflict = { ok: false, message: "Conflict.", retryable: false };
  const cases = [
    [{ status: 200, result: SUCCESS }, "SYNCED", false],
    [{ status: 503, result: retry }, "RETRY", true],
    [{ status: 403, result: conflict }, "FAILED", true],
    [{ status: 409, result: conflict }, "CONFLICT", true],
  ];
  for (const [processed, status, stopped] of cases) {
    const ack = createSyncPushAck(source, processed);
    assert.equal(ack.status, status);
    assert.equal(ack.httpStatus, processed.status);
    assert.equal(shouldStopSyncPush(ack), stopped);
  }
});

test("sync push creates the versioned acknowledgement envelope", () => {
  const ack = createSyncPushAck(event(1), { status: 200, result: SUCCESS });
  assert.deepEqual(createSyncPushResponse(ORGANIZATION_ID, DEVICE_ID, [ack], false), {
    ok: true,
    version: 1,
    organizationId: ORGANIZATION_ID,
    deviceId: DEVICE_ID,
    acks: [ack],
    stoppedEarly: false,
  });
});
