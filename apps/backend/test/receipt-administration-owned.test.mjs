import assert from "node:assert/strict";
import test from "node:test";

import {
  handleOwnedReceiptDelivery,
  handleOwnedReceiptSettings,
} from "../dist/src/pos/receipt-administration-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "50000000-0000-4000-8000-000000000001";
const DELIVERY_ID = "60000000-0000-4000-8000-000000000001";

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
    roleNames: ["Manager"],
    permissions: ["settings.manage", "receipts.reprint"],
    storeIds: [STORE_ID],
    features: {},
    ...overrides,
  };
}

const SETTINGS = {
  businessName: "Razzey Trading",
  businessAddress: "Main Street",
  businessPhone: "+63 900 000 0000",
  businessEmail: "Sales@Example.com",
  businessTaxId: "TIN-123",
  businessWebsite: "https://example.com",
  headerMessage: "Welcome",
  footerMessage: "Thank you",
  paperWidthMm: 80,
  showStoreAddress: true,
  showStorePhone: true,
  showCashier: true,
  showRegister: true,
  showPaymentDetails: true,
};
const DELIVERY = { recipient: "Customer@Example.com", idempotencyKey: IDEMPOTENCY_KEY };
const DELIVERY_ROW = {
  delivery_request_id: DELIVERY_ID,
  delivery_status: "QUEUED",
  was_replayed: false,
};

function request(path, body, headers = {}) {
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
    updateSettings: async () => ({ data: true, error: null }),
    queueDelivery: async () => ({ data: [DELIVERY_ROW], error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned receipt administration requires a bounded bearer before context or body access", async () => {
  let coreCalls = 0;
  const deps = dependencies({
    loadCore: async () => { coreCalls += 1; return { data: core(), error: null }; },
  });
  for (const [handler, path] of [
    [handleOwnedReceiptSettings, "/api/pos/v2/receipt-settings"],
    [handleOwnedReceiptDelivery, `/api/pos/v2/receipts/${RECEIPT_ID}/delivery`],
  ]) {
    await assertBody(
      await handler(request(path, {}, { authorization: "Bearer invalid" }), deps),
      401,
      { ok: false, reason: "AUTH_REQUIRED" },
    );
  }
  assert.equal(coreCalls, 0);
});

test("owned receipt administration preserves organization selection, identity retry, and context failures", async () => {
  let calls = 0;
  const response = await handleOwnedReceiptSettings(
    request("/api/pos/v2/receipt-settings", SETTINGS, { "x-tindio-organization-id": "" }),
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
    await handleOwnedReceiptSettings(
      request("/api/pos/v2/receipt-settings", SETTINGS, { "x-tindio-organization-id": "bad" }),
      dependencies(),
    ),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
  await assertBody(
    await handleOwnedReceiptSettings(request("/api/pos/v2/receipt-settings", SETTINGS), dependencies({
      loadCore: async () => ({ data: core({ profileId: "bad" }), error: null }),
    })),
    503,
    { ok: false, reason: "INVALID_BUSINESS_CONTEXT" },
  );
});

test("owned receipt settings distinguishes malformed JSON and permission-first validation", async () => {
  await assertBody(
    await handleOwnedReceiptSettings(request("/api/pos/v2/receipt-settings", "{"), dependencies()),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  await assertBody(
    await handleOwnedReceiptSettings(request("/api/pos/v2/receipt-settings", {}), dependencies({
      loadCore: async () => ({ data: core({ permissions: [] }), error: null }),
    })),
    200,
    { ok: false, message: "You do not have permission to update receipt settings." },
  );
  await assertBody(
    await handleOwnedReceiptSettings(request("/api/pos/v2/receipt-settings", {}), dependencies()),
    200,
    { ok: false, message: "Check the receipt business information and layout values." },
  );
});

test("owned receipt settings sends exact normalized tenant input and maps success", async () => {
  let observed;
  await assertBody(
    await handleOwnedReceiptSettings(
      request("/api/pos/v2/receipt-settings", { ...SETTINGS, businessName: "  Razzey Trading  ", ignored: true }),
      dependencies({
        updateSettings: async (token, organizationId, input) => {
          observed = { token, organizationId, input };
          return { data: true, error: null };
        },
      }),
    ),
    200,
    {
      ok: true,
      message: "Receipt settings saved. New receipts will preserve this layout; existing receipts stay unchanged.",
    },
  );
  assert.deepEqual(observed, { token: TOKEN, organizationId: ORGANIZATION_ID, input: SETTINGS });
});

test("owned receipt settings preserves business errors and rejects invalid provider success", async () => {
  for (const [updateSettings, message] of [
    [async () => ({ data: null, error: { code: "42501", message: "private" } }), "You do not have permission to perform this receipt action."],
    [async () => ({ data: null, error: { code: "23514", message: "Invalid settings." } }), "Invalid settings."],
    [async () => ({ data: "true", error: null }), "TINDIO could not save the receipt settings."],
    [async () => { throw new Error("private"); }, "TINDIO could not save the receipt settings."],
  ]) {
    await assertBody(
      await handleOwnedReceiptSettings(request("/api/pos/v2/receipt-settings", SETTINGS), dependencies({ updateSettings })),
      200,
      { ok: false, message },
    );
  }
});

test("owned receipt delivery validates path before JSON and permission before input", async () => {
  await assertBody(
    await handleOwnedReceiptDelivery(request("/api/pos/v2/receipts/bad/delivery", "{"), dependencies()),
    400,
    { ok: false, message: "This receipt is invalid." },
  );
  await assertBody(
    await handleOwnedReceiptDelivery(request(`/api/pos/v2/receipts/${RECEIPT_ID}/delivery`, "{"), dependencies()),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  await assertBody(
    await handleOwnedReceiptDelivery(request(`/api/pos/v2/receipts/${RECEIPT_ID}/delivery`, {}), dependencies({
      loadCore: async () => ({ data: core({ permissions: [] }), error: null }),
    })),
    200,
    { ok: false, message: "You do not have permission to queue a digital receipt." },
  );
});

test("owned receipt delivery lets path identity override body and maps replay", async () => {
  let observed;
  await assertBody(
    await handleOwnedReceiptDelivery(
      request(`/api/pos/v2/receipts/${RECEIPT_ID}/delivery`, { ...DELIVERY, receiptId: PROFILE_ID, ignored: true }),
      dependencies({
        queueDelivery: async (token, organizationId, input) => {
          observed = { token, organizationId, input };
          return { data: [{ ...DELIVERY_ROW, was_replayed: true }], error: null };
        },
      }),
    ),
    200,
    { ok: true, message: "This digital receipt request was already queued." },
  );
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    input: { receiptId: RECEIPT_ID, ...DELIVERY },
  });
});

test("owned receipt delivery preserves business errors and rejects invalid provider rows", async () => {
  for (const [queueDelivery, message] of [
    [async () => ({ data: null, error: { code: "42501", message: "private" } }), "You do not have permission to perform this receipt action."],
    [async () => ({ data: null, error: { code: "23505", message: "Delivery key conflict." } }), "Delivery key conflict."],
    [async () => ({ data: [{}], error: null }), "TINDIO could not queue this digital receipt."],
    [async () => { throw new Error("private"); }, "TINDIO could not queue this digital receipt."],
  ]) {
    await assertBody(
      await handleOwnedReceiptDelivery(
        request(`/api/pos/v2/receipts/${RECEIPT_ID}/delivery`, DELIVERY),
        dependencies({ queueDelivery }),
      ),
      200,
      { ok: false, message },
    );
  }
});
