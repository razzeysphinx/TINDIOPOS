import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedCheckout } from "../dist/src/pos/checkout-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_METHOD_ID = "77777777-7777-4777-8777-777777777777";
const SALE_ID = "88888888-8888-4888-8888-888888888888";

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
    idempotencyKey: "99999999-9999-4999-8999-999999999999",
    customerId: null,
    loyaltyRedemptionPoints: 0,
    discountId: null,
    taxRateId: null,
    diningOptionId: null,
    openTicketId: null,
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
      note: "",
    }],
    ...overrides,
  };
}

function request(body = checkout(), headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/checkout", {
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
    ...overrides,
  };
}

async function assertJson(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned checkout reads JSON before authentication and business context", async () => {
  let claimsCalled = false;
  await assertJson(await handleOwnedCheckout(request("not-json", { authorization: "" }), dependencies({
    verifyClaims: async () => { claimsCalled = true; },
  })), 400, {
    ok: false,
    message: "The checkout data is invalid. Return to the cart and try again.",
    retryable: false,
  });
  assert.equal(claimsCalled, false);
});

test("owned checkout requires a bounded three-part bearer after JSON parsing", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertJson(await handleOwnedCheckout(
      request(undefined, { authorization }),
      dependencies(),
    ), 401, { ok: false, reason: "AUTH_REQUIRED" });
  }
});

test("owned checkout preserves Auth, organization, and identity retry classifications", async () => {
  await assertJson(await handleOwnedCheckout(request(), dependencies({
    verifyClaims: async () => { throw Object.assign(new Error("busy"), { status: 429 }); },
  })), 503, { ok: false, reason: "AUTH_PROVIDER_UNAVAILABLE" });
  await assertJson(await handleOwnedCheckout(
    request(undefined, { "x-tindio-organization-id": "invalid" }),
    dependencies(),
  ), 403, { ok: false, reason: "ORGANIZATION_FORBIDDEN" });

  let calls = 0;
  const response = await handleOwnedCheckout(request(), dependencies({
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

test("owned checkout validates complete business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
  ]) {
    await assertJson(await handleOwnedCheckout(request(), dependencies({
      loadCore: async () => ({ data: payload, error: null }),
    })), status, body);
  }
});

test("owned checkout enforces capability, input, and assigned-store conflicts", async () => {
  for (const [payload, value, message] of [
    [core({ permissions: [] }), checkout(), "You do not have permission to complete sales."],
    [core(), checkout({ storeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), "You are not assigned to this store."],
    [core(), checkout({ items: [] }), "Check the payments and cart, then try again."],
  ]) {
    let checkoutCalled = false;
    await assertJson(await handleOwnedCheckout(request(value), dependencies({
      loadCore: async () => ({ data: payload, error: null }),
      checkout: async () => { checkoutCalled = true; },
    })), 409, {
      ok: false,
      message,
      retryable: false,
      ...(message === "Check the payments and cart, then try again."
        ? {}
        : { failureCode: "PERMISSION_CHANGED" }),
    });
    assert.equal(checkoutCalled, false);
  }
});

test("owned checkout sends normalized tenant input and explicit device custody", async () => {
  let observed;
  const body = {
    checkout: checkout(),
    device: {
      deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      secret: "a".repeat(64),
      appVersion: "  android-1.0.0  ",
    },
  };
  const response = await handleOwnedCheckout(request(body), dependencies({
    checkout: async (token, organizationId, input, device) => {
      observed = { token, organizationId, input, device };
      return dependencies().checkout();
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(observed.token, TOKEN);
  assert.equal(observed.organizationId, ORGANIZATION_ID);
  assert.equal(observed.input.storeId, STORE_ID);
  assert.equal(observed.device.appVersion, "android-1.0.0");
});

test("owned checkout maps conflict and retryable RPC failures to frozen HTTP statuses", async () => {
  for (const [error, status, message] of [
    [{ code: "23505", message: "detail" }, 409, "This checkout key belongs to a different transaction. Start a new checkout."],
    [{ code: "40001", message: "detail" }, 503, "The prior checkout did not finish. Try again with a new checkout."],
    [null, 503, "TINDIO could not complete this checkout. Nothing was charged or deducted."],
  ]) {
    await assertJson(await handleOwnedCheckout(request(), dependencies({
      checkout: async () => ({ data: null, error }),
    })), status, {
      ok: false,
      message,
      retryable: status === 503,
    });
  }
});

test("owned checkout maps success and best-effort stock warning", async () => {
  await assertJson(await handleOwnedCheckout(request(), dependencies({
    loadStockWarning: async () => ({ data: 2, error: null }),
  })), 200, {
    ok: true,
    message: "Sale complete. Receipt #42 is ready.",
    data: {
      saleId: SALE_ID,
      receiptNumber: 42,
      totalMinor: 1500,
      changeMinor: 500,
      payments: [],
      wasReplayed: false,
      inventoryWarning: "2 tracked items are now below zero. Review Inventory before the next count or order.",
    },
  });
});

test("owned checkout never reports an ambiguous transport failure as uncharged", async () => {
  for (const overrides of [
    { checkout: async () => { throw new Error("transport"); } },
    { loadStockWarning: async () => { throw new Error("transport after commit"); } },
  ]) {
    await assertJson(await handleOwnedCheckout(request(), dependencies(overrides)), 500, {
      ok: false,
      message: "TINDIO could not confirm this sale. Check Recent receipts before retrying.",
      retryable: true,
    });
  }
});
