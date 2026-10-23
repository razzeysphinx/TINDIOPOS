import assert from "node:assert/strict";
import test from "node:test";
import {
  STOCK_OPERATIONS_COMPATIBILITY_CONTRACT,
  mapCartStockValidationResult,
  mapStockRequestReceiptResult,
  stockRequestIdFromReceiptPath,
  stockRequestReceiptDatabaseMessage,
  toCartStockValidationRpcArguments,
  toStockRequestReceiptRpcArguments,
  validateCartStockOperation,
  validateStockRequestReceipt,
} from "../dist/src/pos/stock-operations-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const REGISTER_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const REQUEST_ID = "40000000-0000-4000-8000-000000000001";
const OPERATION_ID = "50000000-0000-4000-8000-000000000001";
const TRANSFER_LINE_ID = "60000000-0000-4000-8000-000000000001";
const fullContext = {
  permissions: ["pos.access", "sales.create", "payments.accept", "inventory.transfer.receive"],
  assignedStoreIds: [STORE_ID],
  inventoryEnabled: true,
};

test("stock compatibility freezes both final Web-owned routes and database custody", () => {
  assert.equal(STOCK_OPERATIONS_COMPATIBILITY_CONTRACT.routes.validateCart.path, "/api/pos/v2/cart/validate-stock");
  assert.equal(STOCK_OPERATIONS_COMPATIBILITY_CONTRACT.routes.validateCart.rpc, "validate_pos_cart_stock");
  assert.equal(STOCK_OPERATIONS_COMPATIBILITY_CONTRACT.routes.receiveRequest.rpc, "receive_stock_request");
  assert.deepEqual(STOCK_OPERATIONS_COMPATIBILITY_CONTRACT.retainedAuthority, ["negative-stock-policy", "made-to-order-components", "assigned-store", "request-state", "received-only-stock", "discrepancies", "idempotent-replay", "audit-log"]);
});

test("cart validation preserves permission, schema, and assigned-store precedence", () => {
  assert.equal(validateCartStockOperation(null, { ...fullContext, permissions: [] }).result.message, "You do not have permission to start payment.");
  assert.equal(validateCartStockOperation(null, fullContext).result.message, "Check the cart, then try Charge again.");
  const input = { storeId: STORE_ID, registerId: REGISTER_ID, items: [{ productId: PRODUCT_ID, variantId: null, quantity: 1.125 }] };
  assert.equal(validateCartStockOperation(input, { ...fullContext, assignedStoreIds: [] }).result.message, "You are not assigned to this store.");
  assert.equal(validateCartStockOperation(input, fullContext).ok, true);
});

test("cart schema retains item count, UUID, positive quantity, scale, and maximum bounds", () => {
  const base = { storeId: STORE_ID, registerId: REGISTER_ID };
  for (const items of [[], [{ productId: "bad", variantId: null, quantity: 1 }], [{ productId: PRODUCT_ID, variantId: null, quantity: 0 }], [{ productId: PRODUCT_ID, variantId: null, quantity: 1.0001 }], [{ productId: PRODUCT_ID, variantId: null, quantity: 10001 }]]) {
    assert.equal(validateCartStockOperation({ ...base, items }, fullContext).ok, false);
  }
});

test("cart RPC projection binds organization, store, register, and snake-case items", () => {
  const parsed = validateCartStockOperation({ storeId: STORE_ID, registerId: REGISTER_ID, items: [{ productId: PRODUCT_ID, variantId: null, quantity: 2 }] }, fullContext);
  assert.equal(parsed.ok, true);
  assert.deepEqual(toCartStockValidationRpcArguments(ORGANIZATION_ID, parsed.input), {
    target_organization_id: ORGANIZATION_ID,
    target_store_id: STORE_ID,
    target_register_id: REGISTER_ID,
    target_items: [{ product_id: PRODUCT_ID, variant_id: null, quantity: 2 }],
  });
});

test("cart result maps policy, negative items, invalid rows, and checked-at fallback", () => {
  const fallback = "2026-10-23T00:00:00.000Z";
  assert.deepEqual(mapCartStockValidationResult({ policy: "warn", items: [{ product_id: PRODUCT_ID, variant_id: null, product_name: "Coffee", variant_name: null, available_quantity: "1.000", cart_quantity: 2, projected_quantity: -1 }, { broken: true }] }, null, fallback), {
    ok: true,
    policy: "warn",
    items: [{ productId: PRODUCT_ID, variantId: null, productName: "Coffee", variantName: null, availableQuantity: 1, cartQuantity: 2, projectedQuantity: -1 }],
    checkedAt: fallback,
  });
  assert.equal(mapCartStockValidationResult({ policy: "unknown" }, null).message, "TINDIO could not read this store's stock safeguard.");
});

test("cart database failures preserve device, permission, constraint, refresh, and fallback messages", () => {
  assert.equal(mapCartStockValidationResult(null, { code: "42501", message: "Device is revoked." }).message, "Device is revoked.");
  assert.equal(mapCartStockValidationResult(null, { code: "42501", message: "private" }).message, "You do not have permission to complete this sale.");
  assert.equal(mapCartStockValidationResult(null, { code: "23514", message: "Open your shift." }).message, "Open your shift.");
  assert.match(mapCartStockValidationResult(null, { code: "PGRST202" }).message, /refreshing/);
  assert.equal(mapCartStockValidationResult(null, null).message, "TINDIO could not complete this checkout. Nothing was charged or deducted.");
});

test("stock-request receipt path is exact and path identity overrides body", () => {
  assert.equal(stockRequestIdFromReceiptPath(`/api/pos/v2/stock-requests/${REQUEST_ID}/receive`), REQUEST_ID);
  assert.equal(stockRequestIdFromReceiptPath(`/api/pos/v2/stock-requests/${REQUEST_ID}/receive/nested`), null);
  const parsed = validateStockRequestReceipt(REQUEST_ID, { stockRequestId: ORGANIZATION_ID, operationId: OPERATION_ID, note: "  Dock 2  ", lines: [{ stockTransferLineId: TRANSFER_LINE_ID, receivedQuantity: "2.000", shortQuantity: "0", discrepancyNote: "" }] }, fullContext);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.input.stockRequestId, REQUEST_ID);
  assert.equal(parsed.input.note, "Dock 2");
});

test("stock-request receipt preserves feature and permission precedence plus quantity rules", () => {
  assert.equal(validateStockRequestReceipt(REQUEST_ID, null, { ...fullContext, inventoryEnabled: false, permissions: [] }).result.message, "Inventory is disabled for this business.");
  assert.equal(validateStockRequestReceipt(REQUEST_ID, null, { ...fullContext, permissions: [] }).result.message, "You do not have permission to receive stock transfers.");
  const base = { operationId: OPERATION_ID, note: "", lines: [{ stockTransferLineId: TRANSFER_LINE_ID, receivedQuantity: "0", shortQuantity: "0", discrepancyNote: "" }] };
  assert.equal(validateStockRequestReceipt(REQUEST_ID, base, fullContext).result.message, "Check the highlighted replenishment details and try again.");
  assert.equal(validateStockRequestReceipt(REQUEST_ID, { ...base, lines: [{ ...base.lines[0], shortQuantity: "1", discrepancyNote: "x" }] }, fullContext).ok, false);
  assert.equal(validateStockRequestReceipt(REQUEST_ID, { ...base, lines: [{ ...base.lines[0], receivedQuantity: "1.0000" }] }, fullContext).ok, false);
});

test("stock-request receipt RPC projection retains stable operation and exact line payload", () => {
  const parsed = validateStockRequestReceipt(REQUEST_ID, { operationId: OPERATION_ID, note: "Received", lines: [{ stockTransferLineId: TRANSFER_LINE_ID, receivedQuantity: "4.5", shortQuantity: "1", discrepancyNote: "Damaged" }] }, fullContext);
  assert.equal(parsed.ok, true);
  assert.deepEqual(toStockRequestReceiptRpcArguments(ORGANIZATION_ID, parsed.input), {
    target_organization_id: ORGANIZATION_ID,
    target_stock_request_id: REQUEST_ID,
    target_note: "Received",
    target_operation_id: OPERATION_ID,
    target_lines: [{ stock_transfer_line_id: TRANSFER_LINE_ID, received_quantity: "4.5", short_quantity: "1", discrepancy_note: "Damaged" }],
  });
});

test("stock-request receipt maps replay success and established database failures", () => {
  assert.deepEqual(mapStockRequestReceiptResult(REQUEST_ID, null), { ok: true, message: "Receipt recorded. Only the received quantity was added to stock.", data: { stockRequestId: REQUEST_ID } });
  assert.equal(stockRequestReceiptDatabaseMessage({ code: "23505" }), "This warehouse, rule, or document already exists.");
  assert.equal(stockRequestReceiptDatabaseMessage({ code: "23514", message: "private" }), "The replenishment details violate a stock or workflow rule.");
  assert.equal(stockRequestReceiptDatabaseMessage({ code: "42501" }), "You do not have permission or a store assignment for this replenishment operation.");
  assert.deepEqual(mapStockRequestReceiptResult(null, null), { ok: false, message: "TINDIO could not record this receipt." });
});
