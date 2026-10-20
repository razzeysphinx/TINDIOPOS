import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedCustomerCreation } from "../dist/src/pos/customer-creation-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";

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
    permissions: ["pos.access", "sales.create", "customers.manage"],
    storeIds: [STORE_ID],
    features: {},
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+63 912 345 6789",
    address: "12 Computing Way",
    birthday: "1815-12-10",
    notes: "First programmer",
    loyaltyCardCode: "ADA-001",
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    id: CUSTOMER_ID,
    customer_number: 42,
    loyalty_card_code: "ADA-001",
    full_name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "+63 912 345 6789",
    ...overrides,
  };
}

function request(body = input(), headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/customers/create", {
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
    createCustomer: async () => ({ data: row(), error: null }),
    ...overrides,
  };
}

async function assertJson(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned customer creation requires a bounded bearer before reading the body", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    let coreCalled = false;
    await assertJson(await handleOwnedCustomerCreation(
      request("not-json", { authorization }),
      dependencies({ loadCore: async () => { coreCalled = true; } }),
    ), 401, { ok: false, reason: "AUTH_REQUIRED" });
    assert.equal(coreCalled, false);
  }
});

test("owned customer creation preserves Auth classifications", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertJson(
      await handleOwnedCustomerCreation(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }
  await assertJson(await handleOwnedCustomerCreation(request(), dependencies({
    verifyClaims: async () => ({ data: { claims: {} }, error: null }),
  })), 401, { ok: false, reason: "AUTH_INVALID" });
});

test("owned customer creation preserves organization selection and identity retry", async () => {
  const observed = [];
  let calls = 0;
  const response = await handleOwnedCustomerCreation(
    request(undefined, { "x-tindio-organization-id": "" }),
    dependencies({
      loadCore: async (_token, organizationId) => {
        observed.push(organizationId);
        calls += 1;
        return calls === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, [null, null]);
  await assertJson(await handleOwnedCustomerCreation(
    request(undefined, { "x-tindio-organization-id": "invalid" }),
    dependencies(),
  ), 403, { ok: false, reason: "ORGANIZATION_FORBIDDEN" });
});

test("owned customer creation validates the complete business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
  ]) {
    await assertJson(await handleOwnedCustomerCreation(request(), dependencies({
      loadCore: async () => ({ data: payload, error: null }),
    })), status, body);
  }
});

test("owned customer creation checks permission before parsing JSON", async () => {
  let createCalled = false;
  await assertJson(await handleOwnedCustomerCreation(request("not-json"), dependencies({
    loadCore: async () => ({ data: core({ permissions: ["pos.access"] }), error: null }),
    createCustomer: async () => { createCalled = true; },
  })), 200, { ok: false, message: "You do not have permission to manage customers." });
  assert.equal(createCalled, false);
});

test("owned customer creation distinguishes malformed JSON and invalid details", async () => {
  let createCalled = false;
  const deps = dependencies({ createCustomer: async () => { createCalled = true; } });
  await assertJson(await handleOwnedCustomerCreation(request("not-json"), deps), 400, {
    ok: false,
    message: "The request data is invalid.",
  });
  await assertJson(await handleOwnedCustomerCreation(request({}), deps), 200, {
    ok: false,
    message: "Check the customer details and try again.",
  });
  assert.equal(createCalled, false);
});

test("owned customer creation normalizes then sends exact organization input", async () => {
  let observed;
  const response = await handleOwnedCustomerCreation(
    request({ ...input(), fullName: "  Ada Lovelace  ", ignored: "strip" }),
    dependencies({
      createCustomer: async (token, organizationId, value) => {
        observed = { token, organizationId, value };
        return { data: row(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    value: input(),
  });
});

test("owned customer creation preserves constraint, provider, and invalid-row failures", async () => {
  for (const [createCustomer, message] of [
    [async () => ({ data: null, error: { message: "customers_email_length" } }), "Check the customer details and try again."],
    [async () => ({ data: null, error: { message: "provider unavailable" } }), "TINDIO could not save this customer."],
    [async () => { throw new Error("provider detail"); }, "TINDIO could not save this customer."],
    [async () => ({ data: { ...row(), customer_number: "42" }, error: null }), "TINDIO could not save this customer."],
  ]) {
    await assertJson(await handleOwnedCustomerCreation(request(), dependencies({ createCustomer })), 200, {
      ok: false,
      message,
    });
  }
});

test("owned customer creation maps the exact success body", async () => {
  await assertJson(await handleOwnedCustomerCreation(request(), dependencies()), 200, {
    ok: true,
    message: "Customer created.",
    data: {
      id: CUSTOMER_ID,
      customerNumber: 42,
      loyaltyCardCode: "ADA-001",
      fullName: "Ada Lovelace",
      email: "ada@example.com",
      phone: "+63 912 345 6789",
      loyaltyPoints: 0,
    },
  });
});
