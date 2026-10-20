import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_TICKET_SAVE_COMPATIBILITY_CONTRACT,
  mapOpenTicketSaveRpcResult,
  toOpenTicketSaveRpcArguments,
  validateOpenTicketSave,
} from "../dist/src/pos/open-ticket-save-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const REGISTER_ID = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "30000000-0000-4000-8000-000000000001";
const TICKET_ID = "40000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: ["pos.access", "sales.create", "tickets.manage"],
  openTicketsEnabled: true,
  assignedStoreIds: [STORE_ID],
};

const VALID_INPUT = {
  storeId: STORE_ID,
  registerId: REGISTER_ID,
  ticketId: null,
  customerId: null,
  diningOptionId: null,
  assignedEmployeeId: null,
  label: "  Table 7  ",
  note: "  allergy warning  ",
  cart: [{
    productId: PRODUCT_ID,
    variantId: null,
    quantity: 1.25,
    modifierOptionIds: [],
    productName: "Iced tea",
    variantName: null,
    sku: "TEA-1",
    barcode: null,
    categoryId: null,
    priceMinor: 12500,
    unit: "glass",
    isVariablePrice: false,
    allowFractionalQuantity: true,
    manualPriceMinor: null,
    itemNote: "  less ice  ",
  }],
};

function validInput() {
  const result = validateOpenTicketSave(VALID_INPUT, CONTEXT);
  assert.equal(result.ok, true);
  return result.input;
}

test("open-ticket save compatibility freezes route, custody, idempotency, and RPC", () => {
  assert.deepEqual(OPEN_TICKET_SAVE_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/tickets/save",
    permissions: ["pos.access", "sales.create", "tickets.manage"],
    feature: "open_tickets",
    rpc: "save_open_ticket_v2",
    rpcArguments: [
      "target_organization_id",
      "target_store_id",
      "target_register_id",
      "target_ticket_id",
      "target_customer_id",
      "target_dining_option_id",
      "target_assigned_employee_id",
      "target_label",
      "target_note",
      "target_cart",
    ],
    requiresAssignedStore: true,
    requiresOwnedOpenShift: true,
    idempotency: { createWithoutTicketId: "none", updateWithTicketId: "stable-target" },
    actionResponse: { status: 200, headers: { "cache-control": "private, no-store" } },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("open-ticket save compatibility trims input and strips unknown fields", () => {
  const result = validateOpenTicketSave({ ...VALID_INPUT, ignored: "strip-me" }, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.input.label, "Table 7");
  assert.equal(result.input.note, "allergy warning");
  assert.equal(result.input.cart[0].itemNote, "less ice");
  assert.equal("ignored" in result.input, false);
});

test("open-ticket save compatibility rejects missing capabilities, feature, and store scope", () => {
  for (const context of [
    { ...CONTEXT, permissions: ["pos.access", "sales.create"] },
    { ...CONTEXT, openTicketsEnabled: false },
    { ...CONTEXT, assignedStoreIds: [] },
  ]) {
    assert.deepEqual(validateOpenTicketSave(VALID_INPUT, context), {
      ok: false,
      result: { ok: false, message: "Check the ticket details and your store access." },
    });
  }
});

test("open-ticket save compatibility rejects invalid bounds and malformed device custody", () => {
  for (const value of [
    null,
    {},
    { ...VALID_INPUT, label: "" },
    { ...VALID_INPUT, label: "x".repeat(101) },
    { ...VALID_INPUT, note: "x".repeat(501) },
    { ...VALID_INPUT, cart: [] },
    { ...VALID_INPUT, cart: [{ ...VALID_INPUT.cart[0], quantity: 0.0001 }] },
    { ...VALID_INPUT, cart: [{ ...VALID_INPUT.cart[0], quantity: 1.0001 }] },
    { ...VALID_INPUT, device: { deviceId: "bad", secret: "bad", appVersion: "" } },
  ]) {
    assert.deepEqual(validateOpenTicketSave(value, CONTEXT), {
      ok: false,
      result: { ok: false, message: "Check the ticket details and your store access." },
    });
  }
});

test("open-ticket save compatibility maps the exact RPC argument projection", () => {
  assert.deepEqual(toOpenTicketSaveRpcArguments(ORGANIZATION_ID, validInput()), {
    target_organization_id: ORGANIZATION_ID,
    target_store_id: STORE_ID,
    target_register_id: REGISTER_ID,
    target_ticket_id: null,
    target_customer_id: null,
    target_dining_option_id: null,
    target_assigned_employee_id: null,
    target_label: "Table 7",
    target_note: "allergy warning",
    target_cart: [{
      product_id: PRODUCT_ID,
      variant_id: null,
      quantity: 1.25,
      unit_price_minor: null,
      modifier_option_ids: [],
      ticket_line_id: undefined,
      item_note: "less ice",
      productName: "Iced tea",
      variantName: null,
      sku: "TEA-1",
      barcode: null,
      categoryId: null,
      priceMinor: 12500,
      unit: "glass",
      imageUrl: null,
      isVariablePrice: false,
      allowFractionalQuantity: true,
      manualPriceMinor: null,
      modifiers: [],
    }],
  });
});

test("open-ticket save compatibility preserves stable update ticket identity", () => {
  const input = validInput();
  assert.equal(toOpenTicketSaveRpcArguments(ORGANIZATION_ID, { ...input, ticketId: TICKET_ID }).target_ticket_id, TICKET_ID);
});

test("open-ticket save compatibility maps permission, device, constraint, and provider failures", () => {
  for (const [error, message] of [
    [{ code: "42501", message: "Sales permission is required." }, "You do not have permission to change these tickets."],
    [{ code: "42501", message: "This device is unavailable." }, "This device is unavailable."],
    [{ code: "23514", message: "The selected dining option is not active." }, "The selected dining option is not active."],
    [{ code: "P0002", message: "This open ticket is no longer available." }, "TINDIO could not save the ticket change. Nothing was moved."],
    [null, "TINDIO could not save the ticket change. Nothing was moved."],
  ]) {
    assert.deepEqual(mapOpenTicketSaveRpcResult(null, error), { ok: false, message });
  }
});

test("open-ticket save compatibility maps the exact success envelope", () => {
  assert.deepEqual(mapOpenTicketSaveRpcResult([{ ticket_id: TICKET_ID }], null), {
    ok: true,
    ticketId: TICKET_ID,
    message: "Ticket saved.",
  });
});
