import assert from "node:assert/strict";
import test from "node:test";

import { handleOwnedTransferReceipt } from "../dist/src/pos/transfer-receipt-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const TRANSFER_ID = "40000000-0000-4000-8000-000000000001";
const OPERATION_ID = "50000000-0000-4000-8000-000000000001";
const LINE_ID = "60000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "70000000-0000-4000-8000-000000000001";

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
    permissions: ["pos.access", "sales.create", "inventory.transfer.receive"],
    storeIds: [STORE_ID],
    features: { inventory: true, transfers: true },
    ...overrides,
  };
}

const BODY = {
  operationId: OPERATION_ID,
  stockTransferId: RECEIPT_ID,
  note: "  Dock count complete  ",
  lines: [{
    stockTransferLineId: LINE_ID,
    receivedQuantity: "2.500",
    shortQuantity: "1",
    discrepancyNote: "  Damaged carton  ",
  }],
};

function request({ transferId = TRANSFER_ID, body = BODY, headers = {}, suffix = "/receive" } = {}) {
  return new Request(`https://backend.test/api/pos/v2/transfers/${transferId}${suffix}`, {
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
    receive: async () => ({ data: RECEIPT_ID, error: null }),
    ...overrides,
  };
}

async function assertBody(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), body);
}

test("owned transfer receipt requires a bounded bearer before path or body access", async () => {
  let coreCalls = 0;
  await assertBody(
    await handleOwnedTransferReceipt(request({ headers: { authorization: "Bearer invalid" } }), dependencies({
      loadCore: async () => { coreCalls += 1; return { data: core(), error: null }; },
    })),
    401,
    { ok: false, reason: "AUTH_REQUIRED" },
  );
  assert.equal(coreCalls, 0);
});

test("owned transfer receipt preserves Auth, organization selection, and identity retry", async () => {
  let calls = 0;
  const response = await handleOwnedTransferReceipt(
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
    await handleOwnedTransferReceipt(request({ headers: { "x-tindio-organization-id": "bad" } }), dependencies()),
    403,
    { ok: false, reason: "ORGANIZATION_FORBIDDEN" },
  );
});

test("owned transfer receipt validates business context before the path", async () => {
  for (const [payload, status, body] of [
    [null, 503, { ok: false, reason: "INVALID_CORE_RESPONSE" }],
    [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, { ok: false, reason: "NO_ACTIVE_EMPLOYEE" }],
    [core({ profileId: "bad" }), 503, { ok: false, reason: "INVALID_BUSINESS_CONTEXT" }],
    [core({ organization: { ...core().organization, status: "suspended" } }), 403, { ok: false, reason: "ORGANIZATION_INACTIVE" }],
  ]) {
    await assertBody(
      await handleOwnedTransferReceipt(request({ transferId: "bad" }), dependencies({
        loadCore: async () => ({ data: payload, error: null }),
      })),
      status,
      body,
    );
  }
});

test("owned transfer receipt validates the dynamic path before JSON", async () => {
  let receiveCalls = 0;
  const deps = dependencies({
    receive: async () => { receiveCalls += 1; return { data: RECEIPT_ID, error: null }; },
  });
  await assertBody(
    await handleOwnedTransferReceipt(request({ transferId: "bad" }), deps),
    400,
    { ok: false, message: "This transfer is invalid." },
  );
  await assertBody(
    await handleOwnedTransferReceipt(request({ body: "{" }), deps),
    400,
    { ok: false, message: "The request data is invalid." },
  );
  assert.equal(receiveCalls, 0);
});

test("owned transfer receipt preserves feature and permission gate precedence", async () => {
  for (const [context, message] of [
    [core({ features: { inventory: false, transfers: false }, permissions: [] }), "Inventory is disabled for this business."],
    [core({ features: { inventory: true, transfers: false }, permissions: [] }), "You do not have permission to receive stock transfers."],
    [core({ features: { inventory: true, transfers: false } }), "Stock transfers are disabled for this business."],
  ]) {
    await assertBody(
      await handleOwnedTransferReceipt(request(), dependencies({ loadCore: async () => ({ data: context, error: null }) })),
      200,
      { ok: false, message },
    );
  }
});

test("owned transfer receipt overrides body identity and sends exact normalized input", async () => {
  let observed;
  await assertBody(
    await handleOwnedTransferReceipt(request(), dependencies({
      receive: async (token, organizationId, input) => {
        observed = { token, organizationId, input };
        return { data: RECEIPT_ID, error: null };
      },
    })),
    200,
    {
      ok: true,
      message: "Transfer receipt posted and destination stock updated.",
      data: { receiptId: RECEIPT_ID },
    },
  );
  assert.deepEqual(observed, {
    token: TOKEN,
    organizationId: ORGANIZATION_ID,
    input: {
      ...BODY,
      stockTransferId: TRANSFER_ID,
      note: "Dock count complete",
      lines: [{ ...BODY.lines[0], discrepancyNote: "Damaged carton" }],
    },
  });
});

test("owned transfer receipt preserves validation and database failure envelopes", async () => {
  await assertBody(
    await handleOwnedTransferReceipt(request({ body: {} }), dependencies()),
    200,
    { ok: false, message: "Check the highlighted details and try again." },
  );
  for (const [receive, message] of [
    [async () => ({ data: null, error: { code: "23505", message: "private" } }), "This supplier or inventory document already exists."],
    [async () => ({ data: null, error: { code: "42501", message: "private" } }), "You do not have permission to make this inventory change."],
    [async () => { throw new Error("private"); }, "TINDIO could not receive this transfer."],
  ]) {
    await assertBody(
      await handleOwnedTransferReceipt(request(), dependencies({ receive })),
      200,
      { ok: false, message },
    );
  }
});

test("owned transfer receipt rejects invalid provider success data", async () => {
  for (const data of [null, "bad", {}, []]) {
    await assertBody(
      await handleOwnedTransferReceipt(request(), dependencies({ receive: async () => ({ data, error: null }) })),
      200,
      { ok: false, message: "TINDIO could not receive this transfer." },
    );
  }
});
