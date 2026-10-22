import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedSyncPush } from "../dist/src/pos/sync-push-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_METHOD_ID = "77777777-7777-4777-8777-777777777777";
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function core(overrides = {}) {
  return {
    ok: true,
    profileId: PROFILE_ID,
    organization: {
      id: ORGANIZATION_ID,
      name: "Razzey Trading Corp.",
      currencyCode: "PHP",
      timezone: "Asia/Manila",
      status: "active",
      businessType: "retail",
      deviceManagementEnabled: true,
    },
    employee: {
      id: EMPLOYEE_ID,
      employeeNumber: "EMP-001",
      jobTitle: "Cashier",
      name: "Razzey Sphinx",
    },
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "Razzey Trading Corp.", status: "active" }],
    roleNames: ["Cashier"],
    permissions: ["pos.access", "sales.create", "payments.accept"],
    storeIds: [STORE_ID],
    features: { open_tickets: true },
    ...overrides,
  };
}

const DEVICE = {
  deviceId: DEVICE_ID,
  secret: "a".repeat(64),
  appVersion: "mobile-1.0.0",
};

function checkout(sequence) {
  return {
    storeId: STORE_ID,
    registerId: REGISTER_ID,
    idempotencyKey: `99999999-9999-4999-8999-${String(sequence).padStart(12, "0")}`,
    customerId: null,
    loyaltyRedemptionPoints: 0,
    discountId: null,
    taxRateId: null,
    diningOptionId: null,
    openTicketId: null,
    offlineExpectedTotalMinor: 1500,
    items: [{
      productId: PRODUCT_ID,
      variantId: null,
      quantity: 1,
      unitPriceMinor: 1500,
      modifierOptionIds: [],
      itemNote: null,
    }],
    payments: [{
      paymentMethodId: PAYMENT_METHOD_ID,
      tenderedAmount: "20.00",
      referenceNumber: "",
      note: "local cash",
    }],
  };
}

function event(sequence) {
  return {
    eventId: `cccccccc-cccc-4ccc-8ccc-${String(sequence).padStart(12, "0")}`,
    operationType: "SALE_COMPLETED",
    checkout: checkout(sequence),
    offline: {
      localReceiptReference: `OFF-ABC12${sequence}`,
      createdAt: "2026-10-22T08:00:00.000Z",
      shiftId: SHIFT_ID,
      deviceId: DEVICE_ID,
      deviceSequence: sequence,
    },
  };
}

function body(events = [event(1), event(2)]) {
  return { organizationId: ORGANIZATION_ID, device: DEVICE, events };
}

function request(value = body(), headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/sync/push", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

const SUCCESS = {
  ok: true,
  message: "Sale complete.",
  data: {
    saleId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    receiptNumber: 42,
    totalMinor: 1500,
    changeMinor: 500,
    payments: [],
    wasReplayed: false,
    inventoryWarning: null,
  },
};

function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    validateDevice: async () => ({
      data: [{ device_id: DEVICE_ID, store_id: STORE_ID, register_id: REGISTER_ID }],
      error: null,
    }),
    processOfflineCheckout: async () => ({ status: 200, result: SUCCESS }),
    ...overrides,
  };
}

async function responseJson(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}

test("owned sync push loads authenticated business context before parsing JSON", async () => {
  const order = [];
  const response = await handleOwnedSyncPush(request("not-json"), dependencies({
    verifyClaims: async () => {
      order.push("claims");
      return { data: { claims: { sub: "subject" } }, error: null };
    },
    loadCore: async () => {
      order.push("context");
      return { data: core(), error: null };
    },
  }));
  assert.deepEqual(order, ["claims", "context"]);
  assert.deepEqual(await responseJson(response, 400), {
    ok: false,
    message: "Invalid sync push request.",
  });
});

test("owned sync push preserves Auth, organization, and identity retry", async () => {
  assert.deepEqual(await responseJson(await handleOwnedSyncPush(
    request(undefined, { authorization: "" }), dependencies(),
  ), 401), { ok: false, reason: "AUTH_REQUIRED" });
  assert.deepEqual(await responseJson(await handleOwnedSyncPush(
    request(undefined, { "x-tindio-organization-id": "invalid" }), dependencies(),
  ), 403), { ok: false, reason: "ORGANIZATION_FORBIDDEN" });
  let calls = 0;
  const response = await handleOwnedSyncPush(request(), dependencies({
    loadCore: async () => {
      calls += 1;
      return calls === 1
        ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
        : { data: core(), error: null };
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("owned sync push rejects invalid envelopes and unordered identities before device access", async () => {
  let validated = false;
  const invalid = await handleOwnedSyncPush(request({ ...body(), events: [] }), dependencies({
    validateDevice: async () => { validated = true; throw new Error("must not run"); },
  }));
  assert.equal(invalid.status, 400);
  const unordered = await handleOwnedSyncPush(request(body([event(2), event(1)])), dependencies({
    validateDevice: async () => { validated = true; throw new Error("must not run"); },
  }));
  assert.deepEqual(await responseJson(unordered, 400), {
    ok: false,
    message: "The sync batch must contain unique ascending events for this device.",
  });
  assert.equal(validated, false);
});

test("owned sync push rejects body organization drift before device access", async () => {
  let validated = false;
  const response = await handleOwnedSyncPush(request({
    ...body(), organizationId: STORE_ID,
  }), dependencies({
    validateDevice: async () => { validated = true; throw new Error("must not run"); },
  }));
  assert.equal(validated, false);
  assert.deepEqual(await responseJson(response, 403), {
    ok: false,
    message: "POS device validation failed.",
  });
});

test("owned sync push rejects an unvalidated device without processing events", async () => {
  let processed = false;
  const response = await handleOwnedSyncPush(request(), dependencies({
    validateDevice: async () => ({ data: null, error: { code: "42501" } }),
    processOfflineCheckout: async () => { processed = true; throw new Error("must not run"); },
  }));
  assert.equal(processed, false);
  assert.deepEqual(await responseJson(response, 403), {
    ok: false,
    message: "POS device validation failed.",
  });
});

test("owned sync push processes ordered events with cached claims and context", async () => {
  const observed = [];
  const response = await handleOwnedSyncPush(request(), dependencies({
    processOfflineCheckout: async (token, claims, context, input) => {
      observed.push({ token, claims, context, input });
      return { status: 200, result: SUCCESS };
    },
  }));
  const result = await responseJson(response, 200);
  assert.deepEqual(result.acks.map((ack) => [ack.eventId, ack.deviceSequence, ack.status]), [
    [event(1).eventId, 1, "SYNCED"],
    [event(2).eventId, 2, "SYNCED"],
  ]);
  assert.equal(result.stoppedEarly, false);
  assert.equal(result.organizationId, ORGANIZATION_ID);
  assert.equal(result.deviceId, DEVICE_ID);
  assert.equal(observed.length, 2);
  assert.equal(observed[0].token, TOKEN);
  assert.equal(observed[0].claims.sub, "subject");
  assert.equal(observed[0].context.organization.id, ORGANIZATION_ID);
  assert.deepEqual(observed[0].input, {
    checkout: event(1).checkout,
    device: DEVICE,
    offline: event(1).offline,
  });
});

test("owned sync push stops on the first non-SYNCED acknowledgement", async () => {
  let calls = 0;
  const retry = { ok: false, message: "Retry later.", retryable: true };
  const response = await handleOwnedSyncPush(request(), dependencies({
    processOfflineCheckout: async () => {
      calls += 1;
      return { status: 503, result: retry };
    },
  }));
  const result = await responseJson(response, 200);
  assert.equal(calls, 1);
  assert.equal(result.acks.length, 1);
  assert.equal(result.acks[0].status, "RETRY");
  assert.equal(result.stoppedEarly, true);
});

test("owned sync push maps unexpected device or processor failures to the frozen 503", async () => {
  for (const overrides of [
    { validateDevice: async () => { throw new Error("database unavailable"); } },
    { processOfflineCheckout: async () => { throw new Error("processor unavailable"); } },
  ]) {
    assert.deepEqual(await responseJson(await handleOwnedSyncPush(
      request(), dependencies(overrides),
    ), 503), {
      ok: false,
      message: "TINDIO could not process this sync batch.",
    });
  }
});
