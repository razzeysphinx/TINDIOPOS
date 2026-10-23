import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedSaleExchange } from "../dist/src/pos/sale-exchange-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const REFUND_ID = "40000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "50000000-0000-4000-8000-000000000001";
const EXCHANGE_ID = "60000000-0000-4000-8000-000000000001";
const REPLACEMENT_SALE_ID = "70000000-0000-4000-8000-000000000001";

function core(overrides = {}) {
  return {
    ok: true,
    profileId: PROFILE_ID,
    organization: {
      id: ORGANIZATION_ID,
      name: "TINDIO",
      currencyCode: "PHP",
      timezone: "Asia/Manila",
      status: "active",
      businessType: "retail",
      deviceManagementEnabled: true,
    },
    employee: {
      id: EMPLOYEE_ID,
      employeeNumber: "EMP-1",
      jobTitle: "Cashier",
      name: "Cashier",
    },
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "TINDIO", status: "active" }],
    roleNames: ["Cashier"],
    permissions: ["sales.refund", "sales.create"],
    storeIds: [STORE_ID],
    features: {},
    ...overrides,
  };
}

const BODY = {
  refundId: REFUND_ID,
  replacementReceiptNumber: 42,
  idempotencyKey: IDEMPOTENCY_KEY,
};
const ROW = {
  exchange_id: EXCHANGE_ID,
  replacement_sale_id: REPLACEMENT_SALE_ID,
  replacement_receipt_number: 42,
  was_replayed: false,
};

function request({ body = BODY, headers = {}, path = "/api/pos/v2/exchanges/link" } = {}) {
  return new Request(`https://backend.test${path}`, {
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
    link: async () => ({ data: [ROW], error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned sale exchange requires a bounded bearer before context or body access", async () => {
  let coreCalls = 0;
  await assertBody(
    await handleOwnedSaleExchange(request({ headers: { authorization: "Bearer invalid" } }), dependencies({
      loadCore: async () => { coreCalls += 1; return { data: core(), error: null }; },
    })),
    401,
    { ok: false, reason: "AUTH_REQUIRED" },
  );
  assert.equal(coreCalls, 0);
});

test("owned sale exchange preserves Auth, organization selection, and identity retry", async () => {
  let calls = 0;
  const response = await handleOwnedSaleExchange(
    request({ headers: { "x-tindio-organization-id": "" } }),
    dependencies({
      loadCore: async (_token, organizationId) => {
        calls += 1;
        assert.equal(organizationId, null);
        return calls === 1
          ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
          : { data: core(), error: null };
      },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  await assertBody(
    await handleOwnedSaleExchange(request({ headers: { "x-tindio-organization-id": "bad" } }), dependencies()),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned sale exchange validates business context before JSON", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "bad" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
  ]) {
    await assertBody(
      await handleOwnedSaleExchange(request({ body: "{" }), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned sale exchange distinguishes malformed JSON from action validation", async () => {
  await assertBody(
    await handleOwnedSaleExchange(request({ body: "{" }), dependencies()),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  await assertBody(
    await handleOwnedSaleExchange(request({ body: {} }), dependencies()),
    200,
    { ok: false, message: "Choose a completed return and enter a valid replacement receipt number." },
  );
});

test("owned sale exchange preserves both-permission precedence before input validation", async () => {
  for (const permissions of [[], ["sales.refund"], ["sales.create"]]) {
    await assertBody(
      await handleOwnedSaleExchange(request({ body: {} }), dependencies({
        loadCore: async () => ({ data: core({ permissions }), error: null }),
      })),
      200,
      { ok: false, message: "Sales and refund permission are required to record an exchange." },
    );
  }
});

test("owned sale exchange sends exact normalized tenant input and maps replay", async () => {
  let observed;
  await assertBody(
    await handleOwnedSaleExchange(request({ body: { ...BODY, ignored: true } }), dependencies({
      link: async (token, organizationId, input) => {
        observed = { token, organizationId, input };
        return { data: [{ ...ROW, was_replayed: true }], error: null };
      },
    })),
    200,
    { ok: true, message: "This exchange is already linked to receipt #42." },
  );
  assert.deepEqual(observed, { token: TOKEN, organizationId: ORGANIZATION_ID, input: BODY });
});

test("owned sale exchange preserves database business errors and hides provider detail", async () => {
  for (const [link, message] of [
    [async () => ({ data: null, error: { code: "42501", message: "private" } }), "You do not have permission to perform this receipt action."],
    [async () => ({ data: null, error: { code: "23505", message: "Exchange already linked." } }), "Exchange already linked."],
    [async () => ({ data: null, error: { code: "P0002", message: "The completed return was not found." } }), "The completed return was not found."],
    [async () => { throw new Error("private"); }, "TINDIO could not link this return and replacement sale."],
  ]) {
    await assertBody(
      await handleOwnedSaleExchange(request(), dependencies({ link })),
      200,
      { ok: false, message },
    );
  }
});

test("owned sale exchange rejects invalid provider success rows", async () => {
  for (const data of [null, [], [{}], [{ ...ROW, exchange_id: "bad" }], [{ ...ROW, replacement_receipt_number: 0 }]]) {
    await assertBody(
      await handleOwnedSaleExchange(request(), dependencies({ link: async () => ({ data, error: null }) })),
      200,
      { ok: false, message: "TINDIO could not link this return and replacement sale." },
    );
  }
});
