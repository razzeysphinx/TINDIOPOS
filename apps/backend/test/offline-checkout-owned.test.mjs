import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedOfflineCheckout } from "../dist/src/pos/offline-checkout-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_METHOD_ID = "77777777-7777-4777-8777-777777777777";
const SALE_ID = "88888888-8888-4888-8888-888888888888";
const IDEMPOTENCY_KEY = "99999999-9999-4999-8999-999999999999";
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
    permissions: ["pos.access", "sales.create", "payments.accept", "discounts.apply", "tickets.manage"],
    storeIds: [STORE_ID],
    features: { open_tickets: true },
    ...overrides,
  };
}

function checkout(overrides = {}) {
  return {
    storeId: STORE_ID,
    registerId: REGISTER_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
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
    ...overrides,
  };
}

const DEVICE = {
  deviceId: DEVICE_ID,
  secret: "a".repeat(64),
  appVersion: "mobile-1.0.0",
};
const OFFLINE = {
  localReceiptReference: "OFF-ABC123",
  createdAt: "2026-10-22T08:00:00.000Z",
  shiftId: SHIFT_ID,
  deviceId: DEVICE_ID,
  deviceSequence: 7,
};

function wrapped(checkoutOverrides = {}, offlineOverrides = {}, device = DEVICE) {
  return {
    checkout: checkout(checkoutOverrides),
    device,
    offline: { ...OFFLINE, ...offlineOverrides },
  };
}

function request(body = wrapped(), headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/offline-checkout", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    validateDevice: async () => ({
      data: [{ device_id: DEVICE_ID, store_id: STORE_ID, register_id: REGISTER_ID }],
      error: null,
    }),
    reserveSequence: async () => ({
      data: [{ status: "ACCEPTED", server_checkpoint: 6, expected_sequence: 7 }],
      error: null,
    }),
    loadPaymentMethod: async () => ({
      data: { payment_type: "CASH", offline_policy: "cash" },
      error: null,
    }),
    checkout: async () => ({
      data: [{
        sale_id: SALE_ID,
        receipt_number: 42,
        total_minor: 1500,
        change_minor: 500,
        payment_summary: [],
        was_replayed: false,
      }],
      error: null,
    }),
    loadStockWarning: async () => ({ data: 0, error: null }),
    finalizeSequence: async () => ({ data: [{ server_checkpoint: 7 }], error: null }),
    recordOutcome: async () => ({ data: "event", error: null }),
    ...overrides,
  };
}

async function responseJson(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return response.json();
}

test("owned offline checkout loads business context before parsing JSON", async () => {
  const order = [];
  const response = await handleOwnedOfflineCheckout(request("not-json"), dependencies({
    verifyClaims: async () => { order.push("claims"); return { data: { claims: { sub: "subject" } }, error: null }; },
    loadCore: async () => { order.push("context"); return { data: core(), error: null }; },
  }));
  assert.deepEqual(order, ["claims", "context"]);
  assert.deepEqual(await responseJson(response, 400), {
    ok: false,
    message: "The queued sale data is invalid.",
    retryable: false,
  });
});

test("owned offline checkout preserves Auth, organization, and identity retry", async () => {
  assert.deepEqual(await responseJson(await handleOwnedOfflineCheckout(
    request(undefined, { authorization: "" }),
    dependencies(),
  ), 401), { ok: false, reason: "AUTH_REQUIRED" });
  assert.deepEqual(await responseJson(await handleOwnedOfflineCheckout(
    request(undefined, { "x-tindio-organization-id": "invalid" }),
    dependencies(),
  ), 403), { ok: false, reason: "ORGANIZATION_FORBIDDEN" });
  let calls = 0;
  const response = await handleOwnedOfflineCheckout(request(), dependencies({
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

test("owned offline checkout records a body/device identity conflict before database sequencing", async () => {
  let validated = false;
  let recorded;
  const body = wrapped({}, { deviceId: SHIFT_ID });
  const result = await responseJson(await handleOwnedOfflineCheckout(request(body), dependencies({
    validateDevice: async () => { validated = true; throw new Error("must not run"); },
    recordOutcome: async (_token, _organizationId, value, outcome) => {
      recorded = { value, outcome };
      return { data: "event", error: null };
    },
  })), 409);
  assert.equal(validated, false);
  assert.equal(recorded.value.offline.deviceId, SHIFT_ID);
  assert.equal(recorded.outcome.failureCode, "SEQUENCE_CONFLICT");
  assert.equal(result.failureCode, "SEQUENCE_CONFLICT");
});

test("owned offline checkout rejects and records a revoked device as HTTP 403", async () => {
  let recorded = false;
  const result = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    validateDevice: async () => ({ data: null, error: { code: "42501" } }),
    recordOutcome: async () => { recorded = true; return { data: "event", error: null }; },
  })), 403);
  assert.equal(recorded, true);
  assert.equal(result.failureCode, "DEVICE_REVOKED");
});

test("owned offline checkout stops on retryable reservation and records terminal gaps", async () => {
  let recordCalls = 0;
  const retry = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    reserveSequence: async () => ({ data: null, error: { code: "provider" } }),
    recordOutcome: async () => { recordCalls += 1; return { data: "event", error: null }; },
  })), 503);
  assert.equal(retry.retryable, true);
  assert.equal(recordCalls, 0);

  const gap = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    reserveSequence: async () => ({
      data: [{ status: "GAP", server_checkpoint: 4, expected_sequence: 5 }],
      error: null,
    }),
    recordOutcome: async () => { recordCalls += 1; return { data: "event", error: null }; },
  })), 409);
  assert.equal(gap.failureCode, "SEQUENCE_GAP");
  assert.equal(recordCalls, 1);
});

test("owned offline checkout finalizes reserved validation and payment-policy conflicts", async () => {
  for (const overrides of [
    {
      body: wrapped({ offlineExpectedTotalMinor: undefined }),
      dependencies: {},
      failureCode: "DUPLICATE_TRANSACTION",
    },
    {
      body: wrapped(),
      dependencies: {
        loadPaymentMethod: async () => ({ data: { payment_type: "CARD", offline_policy: "disabled" }, error: null }),
      },
      failureCode: "PERMISSION_CHANGED",
    },
  ]) {
    let finalized;
    let recorded = false;
    const result = await responseJson(await handleOwnedOfflineCheckout(
      request(overrides.body),
      dependencies({
        ...overrides.dependencies,
        finalizeSequence: async (_token, _organizationId, _intent, state) => {
          finalized = state;
          return { data: [{ server_checkpoint: 7 }], error: null };
        },
        recordOutcome: async () => { recorded = true; return { data: "event", error: null }; },
      }),
    ), 409);
    assert.equal(finalized, "CONFLICT");
    assert.equal(recorded, true);
    assert.equal(result.failureCode, overrides.failureCode);
    assert.equal(result.sync.serverCheckpoint, 7);
  }
});

test("owned offline checkout finalizes and records a successful sequenced sale", async () => {
  const order = [];
  const result = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    validateDevice: async (...args) => { order.push("device"); return dependencies().validateDevice(...args); },
    reserveSequence: async (...args) => { order.push("reserve"); return dependencies().reserveSequence(...args); },
    loadPaymentMethod: async (...args) => { order.push("payment"); return dependencies().loadPaymentMethod(...args); },
    checkout: async (...args) => { order.push("checkout"); return dependencies().checkout(...args); },
    loadStockWarning: async () => { order.push("warning"); return { data: 2, error: null }; },
    finalizeSequence: async () => { order.push("finalize"); return { data: [{ server_checkpoint: 7 }], error: null }; },
    recordOutcome: async () => { order.push("record"); return { data: "event", error: null }; },
  })), 200);
  assert.deepEqual(order, ["device", "reserve", "payment", "checkout", "warning", "finalize", "record"]);
  assert.equal(result.ok, true);
  assert.equal(result.sync.serverCheckpoint, 7);
  assert.match(result.data.inventoryWarning, /2 tracked items/);
});

test("owned offline checkout leaves retryable checkout failures RECEIVED and unrecorded", async () => {
  let finalized = false;
  let recorded = false;
  const result = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    checkout: async () => ({ data: null, error: { code: "40001", message: "retry" } }),
    finalizeSequence: async () => { finalized = true; throw new Error("must not run"); },
    recordOutcome: async () => { recorded = true; throw new Error("must not run"); },
  })), 503);
  assert.equal(result.retryable, true);
  assert.equal(finalized, false);
  assert.equal(recorded, false);
});

test("owned offline checkout finalizes and records deterministic checkout conflicts", async () => {
  let finalState;
  let recorded;
  const result = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    checkout: async () => ({
      data: null,
      error: { code: "23514", message: "This queued sale total changed while offline." },
    }),
    finalizeSequence: async (_token, _organizationId, _intent, state) => {
      finalState = state;
      return { data: [{ server_checkpoint: 7 }], error: null };
    },
    recordOutcome: async (_token, _organizationId, _body, outcome) => {
      recorded = outcome;
      return { data: "event", error: null };
    },
  })), 409);
  assert.equal(finalState, "CONFLICT");
  assert.equal(recorded.failureCode, "PRICE_CHANGED");
  assert.equal(result.failureCode, "PRICE_CHANGED");
});

test("owned offline checkout reports finalization ambiguity without recording", async () => {
  let recorded = false;
  const result = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    finalizeSequence: async () => ({ data: null, error: { code: "provider" } }),
    recordOutcome: async () => { recorded = true; throw new Error("must not run"); },
  })), 503);
  assert.equal(recorded, false);
  assert.equal(result.retryable, true);
  assert.match(result.message, /could not finalize its sequence checkpoint/);
});

test("owned offline checkout keeps legacy unsequenced bodies compatible", async () => {
  let sequenced = false;
  let recorded = false;
  const result = await responseJson(await handleOwnedOfflineCheckout(
    request(checkout()),
    dependencies({
      validateDevice: async () => { sequenced = true; throw new Error("must not run"); },
      reserveSequence: async () => { sequenced = true; throw new Error("must not run"); },
      finalizeSequence: async () => { sequenced = true; throw new Error("must not run"); },
      recordOutcome: async () => { recorded = true; throw new Error("must not run"); },
    }),
  ), 200);
  assert.equal(result.ok, true);
  assert.equal(sequenced, false);
  assert.equal(recorded, false);
});

test("owned offline checkout maps transport ambiguity to the frozen retry response", async () => {
  const result = await responseJson(await handleOwnedOfflineCheckout(request(), dependencies({
    checkout: async () => { throw new Error("transport"); },
  })), 503);
  assert.deepEqual(result, {
    ok: false,
    message: "TINDIO could not confirm this queued sale. It will remain queued for review.",
    retryable: true,
  });
});
