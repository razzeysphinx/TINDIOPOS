import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosCustomers } from "../dist/src/pos/customers-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
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
    availableOrganizations: [{
      id: ORGANIZATION_ID,
      name: "Razzey Trading Corp.",
      status: "active",
    }],
    roleNames: ["Cashier"],
    permissions: ["pos.access", "sales.create"],
    storeIds: [STORE_ID],
    features: { loyalty: true },
    ...overrides,
  };
}

function request(search = `?store=${STORE_ID}&q=%20Ana%20`, headers = {}) {
  return new Request(`https://backend.tindio.test/api/pos/v2/customers${search}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "customers-request-id",
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    findActiveShift: async () => ({ data: { id: "shift" }, error: null }),
    searchCustomers: async () => ({
      data: [{
        customer_id: CUSTOMER_ID,
        customer_number: 42,
        loyalty_card_code: "LOYAL-42",
        full_name: "Ana Reyes",
        phone: null,
        email: "ana@example.test",
        loyalty_points: 120,
      }],
      error: null,
    }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "customers-request-id");
  assert.deepEqual(await response.json(), body);
}

test("owned customers require a bounded bearer", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertBody(
      await handleOwnedPosCustomers(
        request(undefined, { authorization }),
        dependencies(),
      ),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
    );
  }
});

test("owned customers preserve Auth classifications", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertBody(
      await handleOwnedPosCustomers(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }

  await assertBody(
    await handleOwnedPosCustomers(request(), dependencies({
      verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    })),
    401,
    { ok: false, reason: "AUTH_INVALID" },
  );
});

test("owned customers support default organization selection and reject malformed scope", async () => {
  let observedOrganization = "not-called";
  const response = await handleOwnedPosCustomers(
    request(undefined, { "x-tindio-organization-id": "" }),
    dependencies({
      loadCore: async (_token, organizationId) => {
        observedOrganization = organizationId;
        return { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(observedOrganization, null);

  await assertBody(
    await handleOwnedPosCustomers(
      request(undefined, { "x-tindio-organization-id": "not-a-uuid" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned customers retry only identity mapping", async () => {
  let calls = 0;
  const response = await handleOwnedPosCustomers(request(), dependencies({
    loadCore: async () => {
      calls += 1;
      return calls === 1
        ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
        : { data: core(), error: null };
    },
  }));
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
});

test("owned customers validate business context and POS permissions", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
    [core({ permissions: ["pos.access"] }), 403, { error: "POS access is not permitted." }],
  ]) {
    await assertBody(
      await handleOwnedPosCustomers(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned customers enforce the exact query and assigned store", async () => {
  for (const search of [
    "",
    "?store=bad",
    `?store=${STORE_ID}&q=${"x".repeat(101)}`,
  ]) {
    await assertBody(
      await handleOwnedPosCustomers(request(search), dependencies()),
      400,
      { error: "Choose an assigned store." },
    );
  }

  const otherStore = "66666666-6666-4666-8666-666666666666";
  await assertBody(
    await handleOwnedPosCustomers(request(`?store=${otherStore}`), dependencies()),
    400,
    { error: "Choose an assigned store." },
  );
});

test("owned customers preserve last-value query parsing and bounded search arguments", async () => {
  let observed;
  const response = await handleOwnedPosCustomers(
    request(`?store=bad&store=${STORE_ID}&q=first&q=%20Ana%20`),
    dependencies({
      searchCustomers: async (token, organizationId, query) => {
        observed = { token, organizationId, query };
        return dependencies().searchCustomers(token, organizationId, query);
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    query: { store: STORE_ID, query: "Ana" },
  });
});

test("owned customers enforce the open-shift prerequisite", async () => {
  let observed;
  const response = await handleOwnedPosCustomers(request(), dependencies({
    findActiveShift: async (token, organizationId, storeId, employeeId) => {
      observed = { token, organizationId, storeId, employeeId };
      return { data: null, error: null };
    },
  }));
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    storeId: STORE_ID,
    employeeId: EMPLOYEE_ID,
  });
  await assertBody(response, 403, {
    error: "Open a register shift before looking up customers.",
  });

  for (const findActiveShift of [
    async () => { throw new Error("provider detail"); },
    async () => ({ data: null, error: new Error("query detail") }),
  ]) {
    await assertBody(
      await handleOwnedPosCustomers(request(), dependencies({ findActiveShift })),
      500,
      { error: "The active register shift could not be verified." },
    );
  }
});

test("owned customers preserve customer query denial and failure mapping", async () => {
  for (const [searchCustomers, status] of [
    [async () => { throw new Error("provider detail"); }, 500],
    [async () => ({ data: null, error: { code: "42501" } }), 403],
    [async () => ({ data: null, error: { code: "XX000" } }), 500],
  ]) {
    await assertBody(
      await handleOwnedPosCustomers(request(), dependencies({ searchCustomers })),
      status,
      { error: "Customers could not be loaded for this sale." },
    );
  }
});

test("owned customers reject invalid rows and map the exact response", async () => {
  await assertBody(
    await handleOwnedPosCustomers(request(), dependencies({
      searchCustomers: async () => ({
        data: [{ customer_id: CUSTOMER_ID, customer_number: "42" }],
        error: null,
      }),
    })),
    503,
    { ok: false, reason: "INVALID_CUSTOMERS_RESPONSE" },
  );

  const response = await handleOwnedPosCustomers(request(), dependencies());
  await assertBody(response, 200, {
    customers: [{
      id: CUSTOMER_ID,
      customerNumber: 42,
      loyaltyCardCode: "LOYAL-42",
      fullName: "Ana Reyes",
      phone: null,
      email: "ana@example.test",
      loyaltyPoints: 120,
    }],
  });
});
