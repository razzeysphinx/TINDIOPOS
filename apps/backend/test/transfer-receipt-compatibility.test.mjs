import assert from "node:assert/strict";
import test from "node:test";

import {
  TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT,
  TRANSFER_RECEIPT_ROUTE_MESSAGES,
  mapTransferReceiptRpcResult,
  toTransferReceiptRpcArguments,
  toTransferScopedReceiptInput,
  validateTransferReceipt,
  validateTransferReceiptId,
} from "../dist/src/pos/transfer-receipt-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const TRANSFER_ID = "10000000-0000-4000-8000-000000000001";
const OPERATION_ID = "20000000-0000-4000-8000-000000000001";
const LINE_ID = "30000000-0000-4000-8000-000000000001";
const RECEIPT_ID = "40000000-0000-4000-8000-000000000001";

const CONTEXT = {
  inventoryEnabled: true,
  transfersEnabled: true,
  permissions: ["inventory.transfer.receive"],
};
const VALID_INPUT = {
  operationId: OPERATION_ID,
  stockTransferId: TRANSFER_ID,
  note: "  Dock count complete  ",
  lines: [{
    stockTransferLineId: LINE_ID,
    receivedQuantity: "2.500",
    shortQuantity: "1",
    discrepancyNote: "  Damaged carton  ",
  }],
};

test("transfer receipt freezes route, authority, custody, effects, and responses", () => {
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.method, "POST");
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.path, "/api/pos/v2/transfers/:transferId/receive");
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.pathBuilder(TRANSFER_ID), `/api/pos/v2/transfers/${TRANSFER_ID}/receive`);
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.transferIdentity, "path-overrides-body");
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.permission, "inventory.transfer.receive");
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.rpc, "receive_stock_transfer");
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.destinationCustody, "active-employee-assigned-to-destination-store");
  assert.equal(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.stockEffect, "received-quantity-only-transfer-in-at-destination");
  assert.deepEqual(TRANSFER_RECEIPT_COMPATIBILITY_CONTRACT.actionResponses, {
    resultEnvelope: 200,
    malformedJsonOrTransfer: 400,
    headers: { "cache-control": "private, no-store" },
  });
  assert.deepEqual(TRANSFER_RECEIPT_ROUTE_MESSAGES, {
    malformedJson: "The request data is invalid.",
    invalidTransfer: "This transfer is invalid.",
  });
});

test("transfer receipt validates the path transfer identity", () => {
  assert.deepEqual(validateTransferReceiptId(TRANSFER_ID), { ok: true, transferId: TRANSFER_ID });
  assert.deepEqual(validateTransferReceiptId("bad"), {
    ok: false,
    status: 400,
    result: { ok: false, message: "This transfer is invalid." },
  });
});

test("transfer receipt path identity overrides body identity", () => {
  assert.deepEqual(toTransferScopedReceiptInput({ ...VALID_INPUT, stockTransferId: RECEIPT_ID }, TRANSFER_ID), VALID_INPUT);
  assert.deepEqual(toTransferScopedReceiptInput(null, TRANSFER_ID), { stockTransferId: TRANSFER_ID });
});

test("transfer receipt preserves feature and permission gate precedence", () => {
  assert.deepEqual(validateTransferReceipt(VALID_INPUT, { ...CONTEXT, inventoryEnabled: false, permissions: [] }), {
    ok: false,
    result: { ok: false, message: "Inventory is disabled for this business." },
  });
  assert.deepEqual(validateTransferReceipt(VALID_INPUT, { ...CONTEXT, permissions: [], transfersEnabled: false }), {
    ok: false,
    result: { ok: false, message: "You do not have permission to receive stock transfers." },
  });
  assert.deepEqual(validateTransferReceipt(VALID_INPUT, { ...CONTEXT, transfersEnabled: false }), {
    ok: false,
    result: { ok: false, message: "Stock transfers are disabled for this business." },
  });
});

test("transfer receipt normalizes bounded receipt input", () => {
  const validation = validateTransferReceipt({ ...VALID_INPUT, ignored: true }, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.input, {
    ...VALID_INPUT,
    note: "Dock count complete",
    lines: [{ ...VALID_INPUT.lines[0], discrepancyNote: "Damaged carton" }],
  });
  assert.equal("ignored" in validation.input, false);
});

test("transfer receipt rejects invalid bounds, duplicate lines, empty quantities, and unexplained shortages", () => {
  const cases = [
    null,
    {},
    { ...VALID_INPUT, operationId: "bad" },
    { ...VALID_INPUT, note: "x".repeat(501) },
    { ...VALID_INPUT, lines: [] },
    { ...VALID_INPUT, lines: Array.from({ length: 101 }, (_, index) => ({ ...VALID_INPUT.lines[0], stockTransferLineId: index === 0 ? LINE_ID : "bad" })) },
    { ...VALID_INPUT, lines: [VALID_INPUT.lines[0], VALID_INPUT.lines[0]] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], receivedQuantity: "0", shortQuantity: "0" }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], receivedQuantity: "0", shortQuantity: "1", discrepancyNote: "x" }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], receivedQuantity: "1.0000" }] },
  ];
  for (const input of cases) {
    assert.deepEqual(validateTransferReceipt(input, CONTEXT), {
      ok: false,
      result: { ok: false, message: "Check the highlighted details and try again." },
    });
  }
});

test("transfer receipt maps the exact normalized RPC projection", () => {
  const validation = validateTransferReceipt({
    ...VALID_INPUT,
    lines: [{ ...VALID_INPUT.lines[0], shortQuantity: "0", discrepancyNote: "" }],
  }, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(toTransferReceiptRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_stock_transfer_id: TRANSFER_ID,
    target_note: "Dock count complete",
    target_operation_id: OPERATION_ID,
    target_lines: [{
      stock_transfer_line_id: LINE_ID,
      received_quantity: "2.500",
      short_quantity: "0",
      discrepancy_note: null,
    }],
  });
});

test("transfer receipt maps database code classes without leaking provider detail", () => {
  const cases = [
    ["23505", "This supplier or inventory document already exists."],
    ["23503", "Choose records that belong to this organization."],
    ["23514", "The inventory details violate a business rule. Check available stock and quantities."],
    ["22023", "The inventory details violate a business rule. Check available stock and quantities."],
    ["42501", "You do not have permission to make this inventory change."],
    ["XX000", "TINDIO could not receive this transfer."],
  ];
  for (const [code, message] of cases) {
    assert.deepEqual(mapTransferReceiptRpcResult(null, { code }), { ok: false, message });
  }
  assert.deepEqual(mapTransferReceiptRpcResult(null, null), {
    ok: false,
    message: "TINDIO could not receive this transfer.",
  });
});

test("transfer receipt maps the exact success envelope", () => {
  assert.deepEqual(mapTransferReceiptRpcResult(RECEIPT_ID, null), {
    ok: true,
    message: "Transfer receipt posted and destination stock updated.",
    data: { receiptId: RECEIPT_ID },
  });
});
