import assert from "node:assert/strict";
import test from "node:test";

import {
  CHECKOUT_COMPATIBILITY_CONTRACT,
  mapCheckoutRpcResult,
  toCheckoutRpcArguments,
  validateCheckout,
} from "../dist/src/pos/checkout-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const REGISTER_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const PAYMENT_METHOD_ID = "40000000-0000-4000-8000-000000000001";
const DEVICE_ID = "50000000-0000-4000-8000-000000000001";
const SALE_ID = "60000000-0000-4000-8000-000000000001";
const DISCOUNT_ID = "70000000-0000-4000-8000-000000000001";
const TICKET_ID = "80000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "90000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: [
    "pos.access",
    "sales.create",
    "payments.accept",
    "discounts.apply",
    "tickets.manage",
  ],
  assignedStoreIds: [STORE_ID],
};

const VALID_CHECKOUT = {
  storeId: STORE_ID,
  registerId: REGISTER_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  customerId: null,
  loyaltyRedemptionPoints: 0,
  discountId: null,
  taxRateId: null,
  diningOptionId: null,
  openTicketId: null,
  items: [{
    productId: PRODUCT_ID,
    variantId: null,
    quantity: 1.125,
    unitPriceMinor: 1234,
    modifierOptionIds: [],
    itemNote: "  no onions  ",
  }],
  payments: [{
    paymentMethodId: PAYMENT_METHOD_ID,
    tenderedAmount: " 20.00 ",
    referenceNumber: "  register slip  ",
    note: "  paid cash  ",
  }],
};

test("checkout freezes route, custody, idempotency, financial effects, and responses", () => {
  assert.deepEqual(CHECKOUT_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/checkout",
    authentication: "supabase-verified-three-part-bearer",
    organizationScope: "selected-header-or-authorized-default",
    requestOrder: "json-before-business-context",
    permissions: ["pos.access", "sales.create", "payments.accept"],
    conditionalPermissions: { discount: "discounts.apply", openTicket: "tickets.manage" },
    rpc: "checkout_advanced_sale",
    stockWarningRpc: "get_checkout_stock_warning",
    rpcArguments: [
      "target_organization_id", "target_store_id", "target_register_id",
      "target_idempotency_key", "target_customer_id", "target_loyalty_redemption_points",
      "target_discount_id", "target_tax_rate_id", "target_dining_option_id",
      "target_open_ticket_id", "target_items", "target_payments",
    ],
    acceptedBodies: ["wrapped-checkout-and-device", "legacy-bare-checkout"],
    storeRegisterCustody: "active-assigned-employee-and-active-register",
    shiftCustody: "first-commit-requires-owned-open-shift;completed-replay-does-not",
    deviceCustody: "wrapped-device-forwarded-as-rpc-headers;shift-open-enforces-device",
    idempotency: "organization-key-plus-actor-and-canonical-payload",
    itemBounds: { minimum: 1, maximum: 100, quantityScale: 3 },
    paymentBounds: { minimum: 1, maximum: 10, moneyScale: 2 },
    paymentSemantics: [
      "one-of-applied-or-tendered", "enabled-store-method", "reference-when-required",
      "exact-sale-total", "cash-change-only",
    ],
    stockSemantics: [
      "atomic-sale-and-stock-write", "effective-negative-stock-policy",
      "made-to-order-component-consumption", "best-effort-post-commit-warning",
    ],
    financialEffects: [
      "sale-and-line-snapshots", "payment-snapshots", "receipt-number",
      "inventory-movements", "loyalty-ledger", "open-ticket-completion",
    ],
    actionResponses: {
      success: 200,
      conflict: 409,
      retryable: 503,
      headers: { "cache-control": "private, no-store" },
    },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: {
        ok: false,
        message: "The checkout data is invalid. Return to the cart and try again.",
        retryable: false,
      },
    },
    unconfirmedResponse: {
      status: 500,
      headers: { "cache-control": "private, no-store" },
      body: {
        ok: false,
        message: "TINDIO could not confirm this sale. Check Recent receipts before retrying.",
        retryable: true,
      },
    },
  });
});

test("checkout normalizes a wrapped body and retains explicit device custody", () => {
  const result = validateCheckout({
    checkout: { ...VALID_CHECKOUT, ignored: "strip-me" },
    device: { deviceId: DEVICE_ID, secret: "a".repeat(64), appVersion: "  android-1.0.0  " },
    ignored: "strip-me",
  }, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.bodyShape, "wrapped");
  assert.equal(result.device.appVersion, "android-1.0.0");
  assert.equal(result.input.items[0].itemNote, "no onions");
  assert.equal(result.input.payments[0].tenderedAmount, "20.00");
  assert.equal(result.input.payments[0].referenceNumber, "register slip");
  assert.equal("ignored" in result.input, false);
});

test("checkout retains the legacy bare body used by Mobile", () => {
  const result = validateCheckout(VALID_CHECKOUT, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.bodyShape, "legacy");
  assert.equal(result.device, undefined);
});

test("checkout rejects a missing base capability before request validation", () => {
  assert.deepEqual(validateCheckout(null, {
    ...CONTEXT,
    permissions: ["pos.access", "sales.create"],
  }), {
    ok: false,
    result: {
      ok: false,
      message: "You do not have permission to complete sales.",
      retryable: false,
      failureCode: "PERMISSION_CHANGED",
    },
  });
});

test("checkout rejects invalid item, payment, money, and device bounds", () => {
  for (const input of [
    null,
    {},
    { ...VALID_CHECKOUT, storeId: "bad" },
    { ...VALID_CHECKOUT, items: [] },
    { ...VALID_CHECKOUT, items: [{ ...VALID_CHECKOUT.items[0], quantity: 1.0001 }] },
    { ...VALID_CHECKOUT, payments: [] },
    { ...VALID_CHECKOUT, payments: [{ ...VALID_CHECKOUT.payments[0], tenderedAmount: "1.234" }] },
    { checkout: VALID_CHECKOUT },
    { checkout: VALID_CHECKOUT, device: { deviceId: "bad", secret: "bad", appVersion: "" } },
  ]) {
    assert.deepEqual(validateCheckout(input, CONTEXT), {
      ok: false,
      result: { ok: false, message: "Check the payments and cart, then try again.", retryable: false },
    });
  }
});

test("checkout enforces assigned-store and conditional discount/ticket capabilities", () => {
  for (const [input, context, message] of [
    [VALID_CHECKOUT, { ...CONTEXT, assignedStoreIds: [] }, "You are not assigned to this store."],
    [{ ...VALID_CHECKOUT, discountId: DISCOUNT_ID }, { ...CONTEXT, permissions: CONTEXT.permissions.filter((value) => value !== "discounts.apply") }, "You do not have permission to apply discounts."],
    [{ ...VALID_CHECKOUT, openTicketId: TICKET_ID }, { ...CONTEXT, permissions: CONTEXT.permissions.filter((value) => value !== "tickets.manage") }, "You do not have permission to use open tickets."],
  ]) {
    assert.deepEqual(validateCheckout(input, context), {
      ok: false,
      result: { ok: false, message, retryable: false, failureCode: "PERMISSION_CHANGED" },
    });
  }
});

test("checkout rejects duplicate product/variant lines before database execution", () => {
  assert.equal(validateCheckout({
    ...VALID_CHECKOUT,
    items: [VALID_CHECKOUT.items[0], { ...VALID_CHECKOUT.items[0], quantity: 2 }],
  }, CONTEXT).ok, false);
});

test("checkout maps the exact normalized RPC argument projection", () => {
  const validation = validateCheckout(VALID_CHECKOUT, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(toCheckoutRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_store_id: STORE_ID,
    target_register_id: REGISTER_ID,
    target_idempotency_key: IDEMPOTENCY_KEY,
    target_customer_id: null,
    target_loyalty_redemption_points: 0,
    target_discount_id: null,
    target_tax_rate_id: null,
    target_dining_option_id: null,
    target_open_ticket_id: null,
    target_items: [{
      product_id: PRODUCT_ID,
      variant_id: null,
      quantity: 1.125,
      unit_price_minor: 1234,
      modifier_option_ids: [],
      item_note: "no onions",
    }],
    target_payments: [{
      payment_method_id: PAYMENT_METHOD_ID,
      amount_tendered_minor: 2000,
      reference_number: "register slip",
      note: "paid cash",
    }],
  });
});

test("checkout maps conflict, retryable, provider, device, and no-result failures", () => {
  for (const [error, message, retryable] of [
    [{ code: "42501", message: "Sales permission is required." }, "You do not have permission to complete this sale.", false],
    [{ code: "42501", message: "This device is revoked." }, "This device is revoked.", false],
    [{ code: "23505", message: "detail" }, "This checkout key belongs to a different transaction. Start a new checkout.", false],
    [{ code: "23514", message: "Payments must exactly cover the sale total before completion." }, "Payments must exactly cover the sale total before completion.", false],
    [{ code: "40001", message: "detail" }, "The prior checkout did not finish. Try again with a new checkout.", true],
    [{ code: "PGRST202", message: "detail" }, "The checkout service is refreshing. Reload the POS, wait a few seconds, then try again.", false],
    [{ code: "PGRST999", message: "detail" }, "TINDIO's checkout service could not resolve this request. Reload the POS and try again.", false],
    [{ code: "XX000", message: "provider detail" }, "TINDIO could not complete this checkout. Nothing was charged or deducted.", false],
    [null, "TINDIO could not complete this checkout. Nothing was charged or deducted.", true],
  ]) assert.deepEqual(mapCheckoutRpcResult(null, error), { ok: false, message, retryable });
});

test("checkout maps new and replayed success envelopes with payment and stock warning semantics", () => {
  const row = {
    sale_id: SALE_ID,
    receipt_number: 42,
    total_minor: 1500,
    change_minor: 500,
    payment_summary: [{
      payment_method_id: PAYMENT_METHOD_ID,
      name: "Cash",
      code: "CASH",
      type: "CASH",
      amount_minor: 1500,
      amount_tendered_minor: 2000,
      change_given_minor: 500,
      reference_number: null,
      note: "counter",
    }],
    was_replayed: false,
  };
  assert.deepEqual(mapCheckoutRpcResult(row, null, 2), {
    ok: true,
    message: "Sale complete. Receipt #42 is ready.",
    data: {
      saleId: SALE_ID,
      receiptNumber: 42,
      totalMinor: 1500,
      changeMinor: 500,
      payments: [{
        paymentMethodId: PAYMENT_METHOD_ID,
        name: "Cash",
        code: "CASH",
        type: "CASH",
        amountMinor: 1500,
        tenderedMinor: 2000,
        changeMinor: 500,
        referenceNumber: null,
        note: "counter",
      }],
      wasReplayed: false,
      inventoryWarning: "2 tracked items are now below zero. Review Inventory before the next count or order.",
    },
  });
  assert.equal(mapCheckoutRpcResult({ ...row, was_replayed: true }, null).message, "Receipt #42 was already completed.");
});
