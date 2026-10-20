import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedPosReceiptDetail } from "../dist/src/pos/receipt-detail-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "22222222-2222-4222-8222-222222222222";
const EMPLOYEE_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";
const RECEIPT_ID = "55555555-5555-4555-8555-555555555555";
const SALE_ID = "66666666-6666-4666-8666-666666666666";
const REGISTER_ID = "77777777-7777-4777-8777-777777777777";
const ITEM_ID = "88888888-8888-4888-8888-888888888888";
const PAYMENT_ID = "99999999-9999-4999-8999-999999999999";
const REFUND_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REFUND_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function detail(overrides = {}) {
  return {
    receipt: {
      id: RECEIPT_ID,
      number: 105,
      issuedAt: "2026-10-20T10:00:00.000Z",
      layout: { paper: "80mm", logo: null, sections: ["items", "total"] },
    },
    customerEmail: "customer@example.test",
    sale: {
      id: SALE_ID,
      storeId: STORE_ID,
      registerId: REGISTER_ID,
      currencyCode: "PHP",
      organizationName: "Razzey Trading Corp.",
      storeName: "Main Store",
      registerName: "Register 1",
      cashierName: "Razzey Sphinx",
      subtotalMinor: 12500,
      discountMinor: 500,
      taxMinor: 0,
      totalMinor: 12000,
    },
    items: [{
      id: ITEM_ID,
      name: "Arabica Coffee · Large",
      sku: "COFFEE-L",
      quantity: 1,
      unit: "piece",
      unitPriceMinor: 12500,
      lineTotalMinor: 12500,
    }],
    payments: [{
      id: PAYMENT_ID,
      name: "Cash",
      type: "CASH",
      amountMinor: 12000,
      tenderedMinor: 15000,
      changeMinor: 3000,
      referenceNumber: null,
    }],
    refunds: [{
      id: REFUND_ID,
      number: 1,
      totalMinor: 2500,
      completedAt: "2026-10-20T11:00:00.000Z",
      reason: "Customer request",
      paymentName: "Cash",
      paymentReference: null,
      items: [{
        id: REFUND_ITEM_ID,
        saleItemId: ITEM_ID,
        name: "Arabica Coffee · Large",
        quantity: 0.2,
        unit: "piece",
        lineTotalMinor: 2500,
      }],
    }],
    ...overrides,
  };
}

function request(receiptId = RECEIPT_ID, headers = {}, suffix = "") {
  return new Request(
    `https://backend.tindio.test/api/pos/v2/receipts/${receiptId}${suffix}`,
    {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "x-tindio-organization-id": ORGANIZATION_ID,
        ...headers,
      },
    },
  );
}

function dependencies(overrides = {}) {
  return {
    createRequestId: () => "receipt-detail-request-id",
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    loadReceiptDetail: async () => ({ data: detail(), error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-tindio-request-id"), "receipt-detail-request-id");
  assert.deepEqual(await response.json(), body);
}

test("owned receipt detail requires a bounded bearer", async () => {
  for (const authorization of ["", "Basic token", "Bearer invalid"]) {
    await assertBody(
      await handleOwnedPosReceiptDetail(
        request(undefined, { authorization }),
        dependencies(),
      ),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
    );
  }
});

test("owned receipt detail preserves Auth classifications and subject validation", async () => {
  for (const [verifyClaims, status, reason] of [
    [async () => { throw new SyntaxError("bad token"); }, 401, "AUTH_INVALID"],
    [async () => { throw Object.assign(new Error("busy"), { status: 429 }); }, 503, "AUTH_PROVIDER_UNAVAILABLE"],
    [async () => ({ data: null, error: null }), 503, "AUTH_INVALID"],
    [async () => ({ data: null, error: Object.assign(new Error("down"), { status: 503 }) }), 503, "AUTH_INVALID_OR_UNAVAILABLE"],
    [async () => ({ data: { claims: {} }, error: null }), 401, "AUTH_INVALID"],
  ]) {
    await assertBody(
      await handleOwnedPosReceiptDetail(request(), dependencies({ verifyClaims })),
      status,
      { ok: false, reason },
    );
  }
});

test("owned receipt detail preserves organization selection and retry identity mapping", async () => {
  let calls = 0;
  let observedOrganization = "not-called";
  const response = await handleOwnedPosReceiptDetail(
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
    await handleOwnedPosReceiptDetail(
      request(undefined, { "x-tindio-organization-id": "invalid" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned receipt detail validates business context and permissions", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "invalid" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
    [core({ organization: { ...core().organization, businessType: "unknown" } }), 503, { ok: false, reason: "INVALID_BUSINESS_TYPE" }],
    [core({ permissions: ["pos.access", "sales.create"] }), 403, { ok: false, message: "Receipt access is not permitted." }],
  ]) {
    await assertBody(
      await handleOwnedPosReceiptDetail(request(), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned receipt detail validates the exact UUID path after authorization", async () => {
  for (const [receiptId, suffix] of [
    ["invalid", ""],
    [RECEIPT_ID, "/delivery"],
    [RECEIPT_ID, "/refund"],
  ]) {
    await assertBody(
      await handleOwnedPosReceiptDetail(request(receiptId, {}, suffix), dependencies()),
      400,
      { ok: false, message: "This receipt is invalid." },
    );
  }
});

test("owned receipt detail sends only organization and receipt IDs to the RPC", async () => {
  let observed;
  const response = await handleOwnedPosReceiptDetail(request(), dependencies({
    loadReceiptDetail: async (token, organizationId, receiptId) => {
      observed = { token, organizationId, receiptId };
      return { data: detail(), error: null };
    },
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    receiptId: RECEIPT_ID,
  });
});

test("owned receipt detail maps database failures without provider details", async () => {
  for (const [loadReceiptDetail, status, body] of [
    [async () => { throw new Error("provider detail"); }, 503, { ok: false, reason: "DATABASE_UNAVAILABLE" }],
    [async () => ({ data: null, error: { code: "42501", message: "private" } }), 403, { ok: false, message: "Receipt access is not permitted." }],
    [async () => ({ data: null, error: { code: "XX000", message: "private" } }), 503, { ok: false, reason: "DATABASE_UNAVAILABLE" }],
  ]) {
    await assertBody(
      await handleOwnedPosReceiptDetail(request(), dependencies({ loadReceiptDetail })),
      status,
      body,
    );
  }
});

test("owned receipt detail preserves the unavailable-receipt 404", async () => {
  await assertBody(
    await handleOwnedPosReceiptDetail(request(), dependencies({
      loadReceiptDetail: async () => ({ data: null, error: null }),
    })),
    404,
    { ok: false, message: "This receipt is unavailable." },
  );
});

test("owned receipt detail rejects malformed immutable snapshots", async () => {
  for (const data of [
    [],
    {},
    detail({ receipt: { ...detail().receipt, id: "invalid" } }),
    detail({ payments: [{ ...detail().payments[0], type: "CRYPTO" }] }),
    detail({ refunds: [{ ...detail().refunds[0], items: [{ ...detail().refunds[0].items[0], saleItemId: "invalid" }] }] }),
  ]) {
    await assertBody(
      await handleOwnedPosReceiptDetail(request(), dependencies({
        loadReceiptDetail: async () => ({ data, error: null }),
      })),
      503,
      { ok: false, reason: "INVALID_RECEIPT_RESPONSE" },
    );
  }
});

test("owned receipt detail returns the exact immutable snapshot", async () => {
  const payload = detail();
  await assertBody(
    await handleOwnedPosReceiptDetail(request(), dependencies({
      loadReceiptDetail: async () => ({ data: payload, error: null }),
    })),
    200,
    payload,
  );
});
