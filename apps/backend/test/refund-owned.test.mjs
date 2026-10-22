import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedRefund } from "../dist/src/pos/refund-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const SALE_ID = "50000000-0000-4000-8000-000000000001";
const PAYMENT_ID = "60000000-0000-4000-8000-000000000001";
const KEY = "70000000-0000-4000-8000-000000000001";
const ITEM_ID = "80000000-0000-4000-8000-000000000001";
const APPROVAL_ID = "90000000-0000-4000-8000-000000000001";
const REFUND_ID = "a0000000-0000-4000-8000-000000000001";

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
    permissions: ["pos.access", "sales.create", "receipts.view", "sales.refund"],
    storeIds: [STORE_ID],
    features: { inventory: true },
    ...overrides,
  };
}

const BODY = {
  saleId: "b0000000-0000-4000-8000-000000000001",
  paymentMethodId: PAYMENT_ID,
  idempotencyKey: KEY,
  reason: "  Customer return  ",
  referenceNumber: "  REF-42  ",
  items: [{ saleItemId: ITEM_ID, quantity: 1, returnToStock: false }],
};

function request({ receiptId = RECEIPT_ID, body = BODY, headers = {}, suffix = "/refund" } = {}) {
  return new Request(`https://backend.test/api/pos/v2/receipts/${receiptId}${suffix}`, {
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
    loadReceiptDetail: async () => ({ data: { sale: { id: SALE_ID } }, error: null }),
    refund: async () => ({
      data: [{ refund_id: REFUND_ID, refund_number: 42, total_minor: 1200, was_replayed: false }],
      error: null,
    }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned refund requires a bounded bearer before path or body access", async () => {
  let coreCalls = 0;
  await assertBody(
    await handleOwnedRefund(request({ headers: { authorization: "Bearer invalid" } }), dependencies({
      loadCore: async () => { coreCalls += 1; return { data: core(), error: null }; },
    })),
    401,
    { ok: false, reason: "AUTH_REQUIRED" },
  );
  assert.equal(coreCalls, 0);
});

test("owned refund preserves Auth, organization selection, and identity retry", async () => {
  let calls = 0;
  const response = await handleOwnedRefund(request({ headers: { "x-tindio-organization-id": "" } }), dependencies({
    loadCore: async (_token, organizationId) => {
      calls += 1;
      assert.equal(organizationId, null);
      return calls === 1
        ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null }
        : { data: core(), error: null };
    },
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 2);

  await assertBody(
    await handleOwnedRefund(request({ headers: { "x-tindio-organization-id": "bad" } }), dependencies()),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned refund validates business context before the path", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "bad" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
  ]) {
    await assertBody(
      await handleOwnedRefund(request({ receiptId: "bad" }), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned refund validates the dynamic path before JSON and JSON before receipt access", async () => {
  let receiptCalls = 0;
  const deps = dependencies({
    loadReceiptDetail: async () => { receiptCalls += 1; return { data: { sale: { id: SALE_ID } }, error: null }; },
  });
  await assertBody(
    await handleOwnedRefund(request({ receiptId: "bad" }), deps),
    400,
    { ok: false, message: "This receipt is invalid." },
  );
  await assertBody(
    await handleOwnedRefund(request({ body: "{" }), deps),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  assert.equal(receiptCalls, 0);
});

test("owned refund loads the receipt before bounded action validation", async () => {
  let receiptCalls = 0;
  let refundCalls = 0;
  await assertBody(
    await handleOwnedRefund(request({ body: {} }), dependencies({
      loadReceiptDetail: async () => { receiptCalls += 1; return { data: { sale: { id: SALE_ID } }, error: null }; },
      refund: async () => { refundCalls += 1; return { data: null, error: null }; },
    })),
    200,
    { ok: false, message: "Check the selected quantities, refund method, and reason before continuing." },
  );
  assert.equal(receiptCalls, 1);
  assert.equal(refundCalls, 0);
});

test("owned refund preserves unavailable receipt and bounded lookup failures", async () => {
  await assertBody(
    await handleOwnedRefund(request(), dependencies({
      loadReceiptDetail: async () => ({ data: null, error: null }),
    })),
    404,
    { ok: false, message: "This receipt is unavailable." },
  );
  for (const loadReceiptDetail of [
    async () => { throw new Error("private"); },
    async () => ({ data: null, error: { message: "private" } }),
    async () => ({ data: { sale: { id: "bad" } }, error: null }),
  ]) {
    await assertBody(
      await handleOwnedRefund(request(), dependencies({ loadReceiptDetail })),
      500,
      { ok: false, message: "TINDIO could not process this refund. No payment record or stock change was made." },
    );
  }
});

test("owned refund derives sale custody from the receipt and sends exact normalized input", async () => {
  let observed;
  await assertBody(
    await handleOwnedRefund(request(), dependencies({
      refund: async (token, organizationId, input) => {
        observed = { token, organizationId, input };
        return {
          data: [{ refund_id: REFUND_ID, refund_number: 42, total_minor: 1200, was_replayed: false }],
          error: null,
        };
      },
    })),
    200,
    {
      ok: true,
      message: "Refund #42 was completed.",
      data: { refundId: REFUND_ID, refundNumber: 42, totalMinor: 1200, wasReplayed: false },
    },
  );
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    input: {
      ...BODY,
      saleId: SALE_ID,
      reason: "Customer return",
      referenceNumber: "REF-42",
    },
  });
});

test("owned refund preserves approval fallback and replay mapping", async () => {
  let observedApproval;
  await assertBody(
    await handleOwnedRefund(
      request({ body: { ...BODY, approvalRequestId: APPROVAL_ID } }),
      dependencies({
        loadCore: async () => ({ data: core({ permissions: ["pos.access", "sales.create", "receipts.view"] }), error: null }),
        refund: async (_token, _organizationId, input) => {
          observedApproval = input.approvalRequestId;
          return {
            data: [{ refund_id: REFUND_ID, refund_number: 42, total_minor: 1200, was_replayed: true }],
            error: null,
          };
        },
      }),
    ),
    200,
    {
      ok: true,
      message: "Refund #42 was already completed.",
      data: { refundId: REFUND_ID, refundNumber: 42, totalMinor: 1200, wasReplayed: true },
    },
  );
  assert.equal(observedApproval, APPROVAL_ID);
});

test("owned refund preserves permission and database failure envelopes", async () => {
  await assertBody(
    await handleOwnedRefund(request(), dependencies({
      loadCore: async () => ({ data: core({ permissions: ["pos.access", "sales.create", "receipts.view"] }), error: null }),
    })),
    200,
    { ok: false, message: "You do not have permission to process refunds." },
  );
  for (const [refund, message] of [
    [async () => ({ data: null, error: { code: "23505", message: "private" } }), "This refund key belongs to a different request. Start a new refund."],
    [async () => ({ data: null, error: { code: "23514", message: "A reference is required." } }), "A reference is required."],
    [async () => { throw new Error("private"); }, "TINDIO could not process this refund. No payment record or stock change was made."],
  ]) {
    await assertBody(
      await handleOwnedRefund(request(), dependencies({ refund })),
      200,
      { ok: false, message },
    );
  }
});
