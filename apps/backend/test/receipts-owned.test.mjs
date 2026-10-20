import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosReceipts } from "../dist/src/pos/receipts-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const RECEIPT_ID = "55555555-5555-4555-8555-555555555555";
const SALE_ID = "66666666-6666-4666-8666-666666666666";
const REGISTER_ID = "77777777-7777-4777-8777-777777777777";

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
    permissions: ["pos.access", "sales.create", "receipts.view"],
    storeIds: [STORE_ID],
    features: { loyalty: true },
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return {
    receipt_id: RECEIPT_ID,
    sale_id: SALE_ID,
    receipt_number: 105,
    issued_at: "2026-10-20T10:00:00.000Z",
    store_id: STORE_ID,
    register_id: REGISTER_ID,
    store_name: "Main Store",
    register_name: "Register 1",
    cashier_name: "Razzey Sphinx",
    total_minor: 12500,
    currency_code: "PHP",
    refund_total_minor: 2500,
    refund_count: 1,
    has_refundable_quantity: true,
    payment_methods: [{ name: "Cash", type: "CASH" }],
    ...overrides,
  };
}

function request(search = "?q=%20Main%20&before=106", headers = {}) {
  return new Request(`https://backend.tindio.test/api/pos/v2/receipts${search}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "x-tindio-organization-id": ORGANIZATION_ID,
      ...headers,
    },
  });
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "receipts-request-id",
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    loadReceipts: async () => ({ data: [receipt()], error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "receipts-request-id");
  assert.deepEqual(await response.json(), body);
}

test("owned receipts require a bounded bearer", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertBody(
      await handleOwnedPosReceipts(request(undefined, { authorization }), dependencies()),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
    );
  }
});

test("owned receipts preserve Auth classifications and subject validation", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
    [async () => ({ data: { claims: {} }, error: null }), 401, "AUTH_INVALID"],
  ]) {
    await assertBody(
      await handleOwnedPosReceipts(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }
});

test("owned receipts preserve organization selection and retry identity mapping", async () => {
  let calls = 0;
  let observedOrganization = "not-called";
  const response = await handleOwnedPosReceipts(
    request(undefined, { "x-tindio-organization-id": "" }),
    dependencies({
      loadCore: async (_token, organizationId) => {
        calls += 1;
        observedOrganization = organizationId;
        return calls === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal(observedOrganization, null);

  await assertBody(
    await handleOwnedPosReceipts(
      request(undefined, { "x-tindio-organization-id": "invalid" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned receipts validate business context and receipt permissions", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
    [core({ permissions: ["pos.access", "sales.create"] }), 403, { ok: false, message: "Receipt access is not permitted." }],
  ]) {
    await assertBody(
      await handleOwnedPosReceipts(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned receipts enforce query length and positive safe cursor semantics", async () => {
  for (const search of [
    `?q=${"x".repeat(101)}`,
    "?before=",
    "?before=0",
    "?before=-1",
    "?before=1.5",
    "?before=9007199254740992",
  ]) {
    await assertBody(
      await handleOwnedPosReceipts(request(search), dependencies()),
      400,
      { ok: false, message: "The receipt search is invalid." },
    );
  }
});

test("owned receipts preserve first-value query parsing and cursor coercion", async () => {
  let observed;
  const response = await handleOwnedPosReceipts(
    request("?q=%20Main%20&q=ignored&before=1e2&before=5"),
    dependencies({
      loadReceipts: async (token, organizationId, query) => {
        observed = { token, organizationId, query };
        return dependencies().loadReceipts(token, organizationId, query);
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    query: { query: "Main", beforeReceiptNumber: 100 },
  });
});

test("owned receipts map database failures without exposing provider details", async () => {
  for (const [loadReceipts, status, body] of [
    [async () => { throw new Error("provider detail"); }, 503, { ok: false, reason: "DATABASE_UNAVAILABLE" }],
    [async () => ({ data: null, error: { code: "42501", message: "private" } }), 403, { ok: false, message: "Receipt access is not permitted." }],
    [async () => ({ data: null, error: { code: "XX000", message: "private" } }), 503, { ok: false, reason: "DATABASE_UNAVAILABLE" }],
  ]) {
    await assertBody(
      await handleOwnedPosReceipts(request(), dependencies({ loadReceipts })),
      status,
      body,
    );
  }
});

test("owned receipts reject malformed summaries", async () => {
  for (const data of [
    {},
    [receipt({ receipt_number: "105" })],
    [receipt({ payment_methods: [{ name: "Cash", type: "CRYPTO" }] })],
  ]) {
    await assertBody(
      await handleOwnedPosReceipts(request(), dependencies({
        loadReceipts: async () => ({ data, error: null }),
      })),
      503,
      { ok: false, reason: "INVALID_RECEIPTS_RESPONSE" },
    );
  }
});

test("owned receipts return the exact list response and 25-row continuation signal", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => receipt({
    receipt_number: 105 - index,
  }));
  const response = await handleOwnedPosReceipts(request(), dependencies({
    loadReceipts: async () => ({ data: rows, error: null }),
  }));
  await assertBody(response, 200, { receipts: rows, hasMore: true });
});
