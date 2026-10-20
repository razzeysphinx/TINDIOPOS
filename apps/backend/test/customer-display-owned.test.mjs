import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedCustomerDisplayUpdate } from "../dist/src/pos/customer-display-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_ID = "55555555-5555-4555-8555-555555555555";

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
    features: { customer_display: true },
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    status: "cart",
    currencyCode: "PHP",
    items: [],
    subtotalMinor: 100,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 100,
    customer: null,
    receiptNumber: null,
    changeMinor: 0,
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

function request(body = { sessionId: SESSION_ID, state: state() }, headers = {}) {
  return new Request("https://backend.tindio.test/api/pos/v2/customer-display", {
    method: "PUT",
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
    updateDisplay: async () => ({ data: null, error: null }),
    ...overrides,
  };
}

async function assertJson(response, status, body, cacheControl = null) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), cacheControl);
  assert.deepEqual(await response.json(), body);
}

test("owned customer display requires a bounded bearer before reading the body", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    let coreCalled = false;
    await assertJson(
      await handleOwnedCustomerDisplayUpdate(
        request("not-json", { authorization }),
        dependencies({ loadCore: async () => { coreCalled = true; } }),
      ),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
      "private, no-store",
    );
    assert.equal(coreCalled, false);
  }
});

test("owned customer display preserves Auth classifications", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
  ]) {
    await assertJson(
      await handleOwnedCustomerDisplayUpdate(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
      "private, no-store",
    );
  }

  await assertJson(
    await handleOwnedCustomerDisplayUpdate(request(), dependencies({
      verifyClaims: async () => ({ data: { claims: {} }, error: null }),
    })),
    401,
    { ok: false, reason: "AUTH_INVALID" },
    "private, no-store",
  );
});

test("owned customer display preserves organization selection and identity retry", async () => {
  const observed = [];
  let calls = 0;
  const response = await handleOwnedCustomerDisplayUpdate(
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
  assert.equal(response.status, 204);
  assert.deepEqual(observed, [null, null]);

  await assertJson(
    await handleOwnedCustomerDisplayUpdate(
      request(undefined, { "x-tindio-organization-id": "invalid" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
    "private, no-store",
  );
});

test("owned customer display validates the full business context", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
  ]) {
    await assertJson(
      await handleOwnedCustomerDisplayUpdate(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
      "private, no-store",
    );
  }
});

test("owned customer display checks permissions before parsing the body", async () => {
  let updateCalled = false;
  await assertJson(
    await handleOwnedCustomerDisplayUpdate(
      request("not-json"),
      dependencies({
        loadCore: async () => ({ data: core({ permissions: ["pos.access"] }), error: null }),
        updateDisplay: async () => { updateCalled = true; },
      }),
    ),
    403,
    { error: "POS access is not permitted." },
  );
  assert.equal(updateCalled, false);
});

test("owned customer display validates and normalizes before the exact RPC call", async () => {
  let observed;
  const response = await handleOwnedCustomerDisplayUpdate(
    request({ sessionId: SESSION_ID, state: state(), ignored: "strip" }),
    dependencies({
      updateDisplay: async (token, organizationId, update) => {
        observed = { token, organizationId, update };
        return { data: null, error: null };
      },
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    update: {
      sessionId: SESSION_ID,
      state: { ...state(), payments: [], saleId: null },
    },
  });
});

test("owned customer display rejects malformed bodies without a database mutation", async () => {
  for (const body of ["not-json", {}, { sessionId: "invalid", state: state() }]) {
    let updateCalled = false;
    await assertJson(
      await handleOwnedCustomerDisplayUpdate(request(body), dependencies({
        updateDisplay: async () => { updateCalled = true; },
      })),
      400,
      { error: "The customer display update is invalid." },
    );
    assert.equal(updateCalled, false);
  }
});

test("owned customer display preserves open-shift and generic RPC failures", async () => {
  for (const [updateDisplay, status, error] of [
    [async () => ({ data: null, error: { code: "42501" } }), 403, "An open shift is required for this display."],
    [async () => ({ data: null, error: { code: "XX000" } }), 500, "The display could not be updated."],
    [async () => { throw new Error("provider detail"); }, 500, "The display could not be updated."],
  ]) {
    await assertJson(
      await handleOwnedCustomerDisplayUpdate(request(), dependencies({ updateDisplay })),
      status,
      { error },
    );
  }
});

test("owned customer display returns an empty non-cacheable 204", async () => {
  const response = await handleOwnedCustomerDisplayUpdate(request(), dependencies());
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
});
