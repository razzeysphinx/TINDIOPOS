import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_DISPLAY_COMPATIBILITY_CONTRACT,
  customerDisplayPermissionFailure,
  mapCustomerDisplayRpcError,
  validateCustomerDisplayUpdate,
} from "../dist/src/pos/customer-display-compatibility.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SALE_ID = "22222222-2222-4222-8222-222222222222";

function validState(overrides = {}) {
  return {
    status: "cart",
    currencyCode: "PHP",
    items: [{
      name: "Coffee",
      variantName: null,
      modifiers: ["Extra shot"],
      quantity: 2,
      lineTotalMinor: 30000,
    }],
    subtotalMinor: 30000,
    discountMinor: 0,
    taxMinor: 0,
    totalMinor: 30000,
    payments: [],
    customer: { name: "Guest", loyaltyPoints: 4 },
    saleId: SALE_ID,
    receiptNumber: 12,
    changeMinor: 0,
    updatedAt: "2026-10-20T10:00:00.000Z",
    ...overrides,
  };
}

test("customer-display compatibility freezes method, path, permissions, RPC, arguments, and 204 response", () => {
  assert.deepEqual(CUSTOMER_DISPLAY_COMPATIBILITY_CONTRACT, {
    method: "PUT",
    path: "/api/pos/v2/customer-display",
    permissions: ["pos.access", "sales.create"],
    rpc: "set_customer_display_state",
    rpcArguments: [
      "target_organization_id",
      "target_session_id",
      "target_state",
    ],
    success: {
      status: 204,
      body: null,
      headers: { "cache-control": "no-store" },
    },
  });
});

test("customer-display compatibility accepts and normalizes the exact update body", () => {
  const result = validateCustomerDisplayUpdate({
    sessionId: SESSION_ID,
    state: {
      ...validState(),
      payments: undefined,
      saleId: undefined,
      ignored: "strip-me",
    },
    ignored: "strip-me",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.update.state.payments, []);
  assert.equal(result.update.state.saleId, null);
  assert.equal("ignored" in result.update, false);
  assert.equal("ignored" in result.update.state, false);
});

test("customer-display compatibility accepts every established display status", () => {
  for (const status of ["idle", "cart", "payment", "complete"]) {
    assert.equal(
      validateCustomerDisplayUpdate({ sessionId: SESSION_ID, state: validState({ status }) }).ok,
      true,
    );
  }
});

test("customer-display compatibility rejects malformed outer bodies", () => {
  for (const value of [
    null,
    {},
    { sessionId: "invalid", state: validState() },
    { sessionId: SESSION_ID },
  ]) {
    assert.deepEqual(validateCustomerDisplayUpdate(value), {
      ok: false,
      status: 400,
      body: { error: "The customer display update is invalid." },
    });
  }
});

test("customer-display compatibility rejects invalid status, currency, dates, and identifiers", () => {
  for (const state of [
    validState({ status: "unknown" }),
    validState({ currencyCode: "php" }),
    validState({ currencyCode: "PESO" }),
    validState({ saleId: "invalid" }),
    validState({ receiptNumber: 0 }),
    validState({ updatedAt: "not-a-date" }),
  ]) assert.equal(validateCustomerDisplayUpdate({ sessionId: SESSION_ID, state }).ok, false);
});

test("customer-display compatibility rejects item and collection bounds", () => {
  for (const state of [
    validState({ items: Array.from({ length: 101 }, () => validState().items[0]) }),
    validState({ items: [{ ...validState().items[0], name: "" }] }),
    validState({ items: [{ ...validState().items[0], name: "x".repeat(161) }] }),
    validState({ items: [{ ...validState().items[0], variantName: "x".repeat(161) }] }),
    validState({ items: [{ ...validState().items[0], modifiers: Array(51).fill("x") }] }),
    validState({ items: [{ ...validState().items[0], modifiers: ["x".repeat(101)] }] }),
    validState({ items: [{ ...validState().items[0], quantity: 0 }] }),
    validState({ items: [{ ...validState().items[0], quantity: 10_001 }] }),
    validState({ items: [{ ...validState().items[0], quantity: 1.5 }] }),
  ]) assert.equal(validateCustomerDisplayUpdate({ sessionId: SESSION_ID, state }).ok, false);
});

test("customer-display compatibility rejects money, payment, and customer bounds", () => {
  const overMoneyLimit = 1_000_000_000_001;
  for (const state of [
    validState({ subtotalMinor: -1 }),
    validState({ discountMinor: overMoneyLimit }),
    validState({ taxMinor: 1.5 }),
    validState({ totalMinor: overMoneyLimit }),
    validState({ changeMinor: -1 }),
    validState({ payments: Array.from({ length: 11 }, () => ({
      name: "Cash",
      amountMinor: 1,
      tenderedMinor: null,
      changeMinor: null,
    })) }),
    validState({ payments: [{ name: "", amountMinor: 1, tenderedMinor: null, changeMinor: null }] }),
    validState({ customer: { name: "", loyaltyPoints: 0 } }),
    validState({ customer: { name: "Guest", loyaltyPoints: 100_000_001 } }),
  ]) assert.equal(validateCustomerDisplayUpdate({ sessionId: SESSION_ID, state }).ok, false);
});

test("customer-display compatibility freezes permission and RPC error mapping", () => {
  assert.deepEqual(customerDisplayPermissionFailure(), {
    ok: false,
    status: 403,
    body: { error: "POS access is not permitted." },
  });
  assert.deepEqual(mapCustomerDisplayRpcError({ code: "42501" }), {
    ok: false,
    status: 403,
    body: { error: "An open shift is required for this display." },
  });
  for (const error of [{}, { code: null }, { code: "P0002" }, { code: "22023" }]) {
    assert.deepEqual(mapCustomerDisplayRpcError(error), {
      ok: false,
      status: 500,
      body: { error: "The display could not be updated." },
    });
  }
});
