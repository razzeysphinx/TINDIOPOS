import assert from "node:assert/strict";
import test from "node:test";
import { handleOwnedStockOperation } from "../dist/src/pos/stock-operations-owned.js";

const TOKEN = "header.payload.signature";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const STORE_ID = "30000000-0000-4000-8000-000000000001";
const REGISTER_ID = "40000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "50000000-0000-4000-8000-000000000001";
const REQUEST_ID = "60000000-0000-4000-8000-000000000001";
const OPERATION_ID = "70000000-0000-4000-8000-000000000001";
const LINE_ID = "80000000-0000-4000-8000-000000000001";

function core(overrides = {}) {
  return {
    ok: true, profileId: PROFILE_ID,
    organization: { id: ORGANIZATION_ID, name: "TINDIO", currencyCode: "PHP", timezone: "Asia/Manila", status: "active", businessType: "retail", deviceManagementEnabled: true },
    employee: { id: EMPLOYEE_ID, employeeNumber: "EMP-1", jobTitle: "Cashier", name: "Cashier" },
    availableOrganizations: [{ id: ORGANIZATION_ID, name: "TINDIO", status: "active" }],
    roleNames: ["Cashier"],
    permissions: ["pos.access", "sales.create", "payments.accept", "inventory.transfer.receive"],
    storeIds: [STORE_ID], features: { inventory: true, transfers: true }, ...overrides,
  };
}
const cartBody = { storeId: STORE_ID, registerId: REGISTER_ID, items: [{ productId: PRODUCT_ID, variantId: null, quantity: 2 }] };
const receiptBody = { operationId: OPERATION_ID, stockRequestId: ORGANIZATION_ID, note: "  Dock 2  ", lines: [{ stockTransferLineId: LINE_ID, receivedQuantity: "2.5", shortQuantity: "1", discrepancyNote: "  Damaged  " }] };
function request(action, body = action === "validate-cart" ? cartBody : receiptBody, options = {}) {
  const path = action === "validate-cart" ? "/api/pos/v2/cart/validate-stock" : `/api/pos/v2/stock-requests/${options.requestId ?? REQUEST_ID}/receive${options.suffix ?? ""}`;
  return new Request(`https://backend.test${path}`, { method: "POST", headers: { authorization: options.authorization ?? `Bearer ${TOKEN}`, "content-type": "application/json", "x-tindio-organization-id": options.organization ?? ORGANIZATION_ID }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
function dependencies(overrides = {}) {
  return {
    verifyClaims: async () => ({ data: { claims: { sub: "subject" } }, error: null }),
    loadCore: async () => ({ data: core(), error: null }),
    validateCart: async () => ({ data: { policy: "warn", items: [], checked_at: "2026-10-23T01:00:00.000Z" }, error: null }),
    receiveRequest: async () => ({ data: REQUEST_ID, error: null }), ...overrides,
  };
}
async function assertBody(response, status, body) { assert.equal(response.status, status); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.deepEqual(await response.json(), body); }

test("owned stock operations require a bounded bearer before context or JSON", async () => {
  let calls = 0;
  await assertBody(await handleOwnedStockOperation(request("validate-cart", "{", { authorization: "Bearer invalid" }), "validate-cart", dependencies({ loadCore: async () => { calls += 1; return { data: core(), error: null }; } })), 401, { ok: false, reason: "AUTH_REQUIRED" });
  assert.equal(calls, 0);
});

test("owned stock operations preserve organization selection and identity retry", async () => {
  let calls = 0;
  const response = await handleOwnedStockOperation(request("validate-cart", cartBody, { organization: "" }), "validate-cart", dependencies({ loadCore: async (_token, organizationId) => { calls += 1; assert.equal(organizationId, null); return calls === 1 ? { data: { ok: false, reason: "IDENTITY_UNMAPPED" }, error: null } : { data: core(), error: null }; } }));
  assert.equal(response.status, 200); assert.equal(calls, 2);
  await assertBody(await handleOwnedStockOperation(request("validate-cart", cartBody, { organization: "bad" }), "validate-cart", dependencies()), 403, { ok: false, reason: "ORGANIZATION_FORBIDDEN" });
});

test("owned stock operations validate complete context before path or JSON", async () => {
  for (const [payload, status, expected] of [[null, 503, "INVALID_CORE_RESPONSE"], [{ ok: false, reason: "NO_ACTIVE_EMPLOYEE" }, 403, "NO_ACTIVE_EMPLOYEE"], [core({ profileId: "bad" }), 503, "INVALID_BUSINESS_CONTEXT"], [core({ organization: { ...core().organization, status: "suspended" } }), 403, "ORGANIZATION_INACTIVE"]]) {
    await assertBody(await handleOwnedStockOperation(request("receive-request", "{", { requestId: "bad" }), "receive-request", dependencies({ loadCore: async () => ({ data: payload, error: null }) })), status, { ok: false, reason: expected });
  }
});

test("owned receipt validates dynamic identity before malformed JSON", async () => {
  let calls = 0; const deps = dependencies({ receiveRequest: async () => { calls += 1; return { data: REQUEST_ID, error: null }; } });
  await assertBody(await handleOwnedStockOperation(request("receive-request", "{", { requestId: "bad" }), "receive-request", deps), 400, { ok: false, message: "This stock request is invalid." });
  await assertBody(await handleOwnedStockOperation(request("receive-request", "{"), "receive-request", deps), 400, { ok: false, message: "The request data is invalid." });
  assert.equal(calls, 0);
});

test("owned cart preserves malformed JSON then permission, schema, and store precedence", async () => {
  await assertBody(await handleOwnedStockOperation(request("validate-cart", "{"), "validate-cart", dependencies()), 400, { ok: false, message: "The request data is invalid." });
  for (const [context, body, message] of [[core({ permissions: [] }), null, "You do not have permission to start payment."], [core(), {}, "Check the cart, then try Charge again."], [core({ storeIds: [] }), cartBody, "You are not assigned to this store."]]) {
    await assertBody(await handleOwnedStockOperation(request("validate-cart", body), "validate-cart", dependencies({ loadCore: async () => ({ data: context, error: null }) })), 200, { ok: false, message });
  }
});

test("owned cart sends exact tenant input and maps stock policy result", async () => {
  let observed;
  await assertBody(await handleOwnedStockOperation(request("validate-cart"), "validate-cart", dependencies({ validateCart: async (token, organizationId, input) => { observed = { token, organizationId, input }; return { data: { policy: "block", items: [{ product_id: PRODUCT_ID, variant_id: null, product_name: "Coffee", variant_name: null, available_quantity: 1, cart_quantity: 2, projected_quantity: -1 }], checked_at: "2026-10-23T01:00:00.000Z" }, error: null }; } })), 200, { ok: true, policy: "block", items: [{ productId: PRODUCT_ID, variantId: null, productName: "Coffee", variantName: null, availableQuantity: 1, cartQuantity: 2, projectedQuantity: -1 }], checkedAt: "2026-10-23T01:00:00.000Z" });
  assert.deepEqual(observed, { token: TOKEN, organizationId: ORGANIZATION_ID, input: cartBody });
});

test("owned cart preserves database and provider failure envelopes", async () => {
  for (const [validateCart, message] of [[async () => ({ data: null, error: { code: "42501", message: "private" } }), "You do not have permission to complete this sale."], [async () => ({ data: null, error: { code: "23514", message: "Open your shift." } }), "Open your shift."], [async () => { throw new Error("private"); }, "TINDIO could not complete this checkout. Nothing was charged or deducted."]]) {
    await assertBody(await handleOwnedStockOperation(request("validate-cart"), "validate-cart", dependencies({ validateCart })), 200, { ok: false, message });
  }
});

test("owned receipt preserves feature and permission precedence", async () => {
  for (const [context, message] of [[core({ features: { inventory: false }, permissions: [] }), "Inventory is disabled for this business."], [core({ permissions: [] }), "You do not have permission to receive stock transfers."]]) {
    await assertBody(await handleOwnedStockOperation(request("receive-request", {}), "receive-request", dependencies({ loadCore: async () => ({ data: context, error: null }) })), 200, { ok: false, message });
  }
});

test("owned receipt overrides body identity and sends normalized tenant input", async () => {
  let observed;
  await assertBody(await handleOwnedStockOperation(request("receive-request"), "receive-request", dependencies({ receiveRequest: async (token, organizationId, input) => { observed = { token, organizationId, input }; return { data: REQUEST_ID, error: null }; } })), 200, { ok: true, message: "Receipt recorded. Only the received quantity was added to stock.", data: { stockRequestId: REQUEST_ID } });
  assert.deepEqual(observed, { token: TOKEN, organizationId: ORGANIZATION_ID, input: { ...receiptBody, stockRequestId: REQUEST_ID, note: "Dock 2", lines: [{ ...receiptBody.lines[0], discrepancyNote: "Damaged" }] } });
});

test("owned receipt preserves replay, validation, database, and transport envelopes", async () => {
  await assertBody(await handleOwnedStockOperation(request("receive-request", {}), "receive-request", dependencies()), 200, { ok: false, message: "Check the highlighted replenishment details and try again." });
  for (const [receiveRequest, message] of [[async () => ({ data: null, error: { code: "23505", message: "private" } }), "This warehouse, rule, or document already exists."], [async () => ({ data: null, error: { code: "42501", message: "private" } }), "You do not have permission or a store assignment for this replenishment operation."], [async () => { throw new Error("private"); }, "TINDIO could not record this receipt."]]) {
    await assertBody(await handleOwnedStockOperation(request("receive-request"), "receive-request", dependencies({ receiveRequest })), 200, { ok: false, message });
  }
});
