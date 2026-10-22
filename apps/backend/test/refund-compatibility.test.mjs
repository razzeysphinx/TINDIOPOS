import assert from "node:assert/strict";
import test from "node:test";

import {
  REFUND_COMPATIBILITY_CONTRACT,
  REFUND_ROUTE_MESSAGES,
  mapRefundRpcResult,
  toReceiptScopedRefundInput,
  toRefundRpcArguments,
  validateRefundReceiptId,
  validateRefundSale,
} from "../dist/src/pos/refund-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "10000000-0000-4000-8000-000000000001";
const SALE_ID = "20000000-0000-4000-8000-000000000001";
const PAYMENT_METHOD_ID = "30000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "40000000-0000-4000-8000-000000000001";
const SALE_ITEM_ID = "50000000-0000-4000-8000-000000000001";
const APPROVAL_ID = "60000000-0000-4000-8000-000000000001";
const REFUND_ID = "70000000-0000-4000-8000-000000000001";

const VALID_INPUT = {
  saleId: SALE_ID,
  paymentMethodId: PAYMENT_METHOD_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  reason: "  Customer return  ",
  referenceNumber: "  BANK-42  ",
  items: [{ saleItemId: SALE_ITEM_ID, quantity: 2 }],
};

test("refund freezes route, authority, receipt custody, financial effects, and responses", () => {
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.method, "POST");
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.path, "/api/pos/v2/receipts/:receiptId/refund");
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.pathBuilder(RECEIPT_ID), `/api/pos/v2/receipts/${RECEIPT_ID}/refund`);
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.saleIdentity, "derived-from-immutable-receipt-detail-and-overrides-body");
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.permission, "sales.refund");
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.permissionOrApproval, true);
  assert.equal(REFUND_COMPATIBILITY_CONTRACT.rpc, "refund_sale");
  assert.deepEqual(REFUND_COMPATIBILITY_CONTRACT.actionResponses, {
    resultEnvelope: 200,
    malformedJsonOrReceipt: 400,
    unavailableReceipt: 404,
    headers: { "cache-control": "private, no-store" },
  });
  assert.deepEqual(REFUND_ROUTE_MESSAGES, {
    malformedJson: "The request data is invalid.",
    invalidReceipt: "This receipt is invalid.",
    unavailableReceipt: "This receipt is unavailable.",
  });
});

test("refund validates the path receipt identity", () => {
  assert.deepEqual(validateRefundReceiptId(RECEIPT_ID), { ok: true, receiptId: RECEIPT_ID });
  assert.deepEqual(validateRefundReceiptId("bad"), {
    ok: false,
    status: 400,
    result: { ok: false, message: "This receipt is invalid." },
  });
});

test("refund derives sale identity from receipt detail and ignores body sale identity", () => {
  assert.deepEqual(toReceiptScopedRefundInput({ ...VALID_INPUT, saleId: APPROVAL_ID }, SALE_ID), VALID_INPUT);
  assert.deepEqual(toReceiptScopedRefundInput(null, SALE_ID), { saleId: SALE_ID });
});

test("refund normalizes bounded input and defaults historical restocking", () => {
  const validation = validateRefundSale({ ...VALID_INPUT, ignored: true }, { permissions: ["sales.refund"] });
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.input, {
    ...VALID_INPUT,
    reason: "Customer return",
    referenceNumber: "BANK-42",
    items: [{ saleItemId: SALE_ITEM_ID, quantity: 2, returnToStock: true }],
  });
  assert.equal("ignored" in validation.input, false);
});

test("refund accepts permission or an approval identity and rejects neither", () => {
  assert.equal(validateRefundSale(VALID_INPUT, { permissions: ["sales.refund"] }).ok, true);
  assert.equal(validateRefundSale({ ...VALID_INPUT, approvalRequestId: APPROVAL_ID }, { permissions: [] }).ok, true);
  assert.deepEqual(validateRefundSale(VALID_INPUT, { permissions: [] }), {
    ok: false,
    result: { ok: false, message: "You do not have permission to process refunds." },
  });
});

test("refund rejects invalid identities, bounds, quantities, reference, and reason", () => {
  const cases = [
    null,
    {},
    { ...VALID_INPUT, paymentMethodId: "bad" },
    { ...VALID_INPUT, reason: "x" },
    { ...VALID_INPUT, referenceNumber: "x".repeat(121) },
    { ...VALID_INPUT, items: [] },
    { ...VALID_INPUT, items: [{ saleItemId: SALE_ITEM_ID, quantity: 0 }] },
    { ...VALID_INPUT, items: [{ saleItemId: SALE_ITEM_ID, quantity: 10_001 }] },
  ];
  for (const input of cases) {
    assert.deepEqual(validateRefundSale(input, { permissions: ["sales.refund"] }), {
      ok: false,
      result: {
        ok: false,
        message: "Check the selected quantities, refund method, and reason before continuing.",
      },
    });
  }
});

test("refund maps the exact normalized RPC projection", () => {
  const validation = validateRefundSale(
    { ...VALID_INPUT, referenceNumber: "", approvalRequestId: APPROVAL_ID },
    { permissions: [] },
  );
  assert.equal(validation.ok, true);
  assert.deepEqual(toRefundRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_sale_id: SALE_ID,
    target_payment_method_id: PAYMENT_METHOD_ID,
    target_idempotency_key: IDEMPOTENCY_KEY,
    target_reason: "Customer return",
    target_reference_number: null,
    target_items: [{ sale_item_id: SALE_ITEM_ID, quantity: 2, return_to_stock: true }],
    target_approval_request_id: APPROVAL_ID,
  });
});

test("refund maps permission, idempotency, constraint, incomplete, and provider failures", () => {
  const cases = [
    [{ code: "42501", message: "private" }, "You do not have permission to process refunds for this sale."],
    [{ code: "23505", message: "private" }, "This refund key belongs to a different request. Start a new refund."],
    [{ code: "23514", message: "Select an enabled payment method." }, "Select an enabled payment method."],
    [{ code: "40001", message: "private" }, "The prior refund did not finish. Try again with a new refund."],
    [{ code: "XX000", message: "provider detail" }, "TINDIO could not process this refund. No payment record or stock change was made."],
  ];
  for (const [error, message] of cases) {
    assert.deepEqual(mapRefundRpcResult(null, error), { ok: false, message });
  }
  assert.deepEqual(mapRefundRpcResult(null, null), {
    ok: false,
    message: "TINDIO could not process this refund. No payment record or stock change was made.",
  });
});

test("refund maps new and replayed success envelopes", () => {
  for (const wasReplayed of [false, true]) {
    assert.deepEqual(mapRefundRpcResult([{
      refund_id: REFUND_ID,
      refund_number: 42,
      total_minor: 1500,
      was_replayed: wasReplayed,
    }], null), {
      ok: true,
      message: wasReplayed
        ? "Refund #42 was already completed."
        : "Refund #42 was completed.",
      data: {
        refundId: REFUND_ID,
        refundNumber: 42,
        totalMinor: 1500,
        wasReplayed,
      },
    });
  }
});
