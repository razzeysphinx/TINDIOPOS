import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_TICKET_SPLIT_COMPATIBILITY_CONTRACT,
  mapOpenTicketSplitRpcResult,
  toOpenTicketSplitRpcArguments,
  validateOpenTicketSplit,
} from "../dist/src/pos/open-ticket-split-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SOURCE_TICKET_ID = "10000000-0000-4000-8000-000000000001";
const SPLIT_TICKET_ID = "20000000-0000-4000-8000-000000000001";
const LINE_ID = "30000000-0000-4000-8000-000000000001";
const DEVICE_ID = "50000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: ["pos.access", "sales.create", "tickets.manage"],
  openTicketsEnabled: true,
};

const VALID_INPUT = {
  sourceTicketId: SOURCE_TICKET_ID,
  label: "  Patio split  ",
  lines: [{ ticketLineId: LINE_ID, quantity: 1.125 }],
  device: {
    deviceId: DEVICE_ID,
    secret: "a".repeat(64),
    appVersion: "  android-1.0.0  ",
  },
};

test("open-ticket split freezes route, scope, inheritance, source policy, audit, and RPC", () => {
  assert.deepEqual(OPEN_TICKET_SPLIT_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/tickets/split",
    permissions: ["pos.access", "sales.create", "tickets.manage"],
    feature: "open_tickets",
    rpc: "split_open_ticket",
    rpcArguments: [
      "target_organization_id",
      "target_source_ticket_id",
      "target_label",
      "target_lines",
    ],
    ticketScope: "organization-open-source-ticket",
    destinationInheritance: [
      "store", "register", "assigned-employee", "customer", "dining-option", "note",
    ],
    requiresOwnedOpenShift: true,
    labelBounds: { minimumLength: 1, maximumLength: 100, trimmed: true },
    lineBounds: {
      minimumLines: 1,
      maximumLines: 100,
      minimumQuantity: 0.001,
      maximumQuantity: 10_000,
      quantityScale: 3,
    },
    databaseOnlyValidation: [
      "unique-line-identifiers",
      "line-still-present",
      "quantity-not-above-saved",
      "destination-maximum-100-lines",
    ],
    partialLineBehavior: "clone-with-new-ticket-line-id",
    allSelectedSourceBehavior: "source-cart-remains-unchanged",
    audit: { event: "OPEN_TICKET_SPLIT", action: "ticket.split" },
    actionResponse: { status: 200, headers: { "cache-control": "private, no-store" } },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("open-ticket split trims labels and device versions while stripping extras", () => {
  const result = validateOpenTicketSplit({
    ...VALID_INPUT,
    ignored: "strip-me",
    lines: [{ ...VALID_INPUT.lines[0], ignored: "strip-me" }],
  }, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.input.label, "Patio split");
  assert.equal(result.input.device.appVersion, "android-1.0.0");
  assert.equal("ignored" in result.input, false);
  assert.equal("ignored" in result.input.lines[0], false);
});

test("open-ticket split accepts absent or null device credentials", () => {
  for (const input of [
    { ...VALID_INPUT, device: undefined },
    { ...VALID_INPUT, device: null },
  ]) assert.equal(validateOpenTicketSplit(input, CONTEXT).ok, true);
});

test("open-ticket split rejects missing capabilities and feature", () => {
  for (const context of [
    { ...CONTEXT, permissions: ["pos.access", "sales.create"] },
    { ...CONTEXT, openTicketsEnabled: false },
  ]) {
    assert.deepEqual(validateOpenTicketSplit(VALID_INPUT, context), {
      ok: false,
      result: { ok: false, message: "Enter a name and choose valid ticket items." },
    });
  }
});

test("open-ticket split rejects invalid ticket, label, line, quantity, and custody bounds", () => {
  for (const input of [
    null,
    {},
    { ...VALID_INPUT, sourceTicketId: "bad" },
    { ...VALID_INPUT, label: "" },
    { ...VALID_INPUT, label: "x".repeat(101) },
    { ...VALID_INPUT, lines: [] },
    { ...VALID_INPUT, lines: Array.from({ length: 101 }, (_, index) => ({ ...VALID_INPUT.lines[0], quantity: index + 1 })) },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], ticketLineId: "bad" }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], quantity: 0 }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], quantity: 10_001 }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], quantity: 1.0001 }] },
    { ...VALID_INPUT, device: { deviceId: "bad", secret: "bad", appVersion: "" } },
  ]) {
    assert.deepEqual(validateOpenTicketSplit(input, CONTEXT), {
      ok: false,
      result: { ok: false, message: "Enter a name and choose valid ticket items." },
    });
  }
});

test("open-ticket split preserves database-only duplicate-line validation", () => {
  assert.equal(validateOpenTicketSplit({
    ...VALID_INPUT,
    lines: [VALID_INPUT.lines[0], VALID_INPUT.lines[0]],
  }, CONTEXT).ok, true);
});

test("open-ticket split maps the exact normalized RPC argument projection", () => {
  const validation = validateOpenTicketSplit(VALID_INPUT, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(toOpenTicketSplitRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_source_ticket_id: SOURCE_TICKET_ID,
    target_label: "Patio split",
    target_lines: [{ ticket_line_id: LINE_ID, quantity: 1.125 }],
  });
});

test("open-ticket split maps permission, device, constraint, missing-source, and provider failures", () => {
  for (const [ticketId, error, message] of [
    [null, { code: "42501", message: "Sales permission is required." }, "You do not have permission to change these tickets."],
    [null, { code: "42501", message: "This device is unavailable." }, "This device is unavailable."],
    [null, { code: "23514", message: "Enter a split-ticket name up to 100 characters." }, "Enter a split-ticket name up to 100 characters."],
    [null, { code: "P0002", message: "The source ticket is no longer open." }, "TINDIO could not save the ticket change. Nothing was moved."],
    [null, { code: "XX000", message: "provider detail" }, "TINDIO could not save the ticket change. Nothing was moved."],
    [null, null, "TINDIO could not save the ticket change. Nothing was moved."],
  ]) assert.deepEqual(mapOpenTicketSplitRpcResult(ticketId, error), { ok: false, message });
});

test("open-ticket split maps the exact success envelope and ticket identity", () => {
  assert.deepEqual(mapOpenTicketSplitRpcResult(SPLIT_TICKET_ID, null), {
    ok: true,
    ticketId: SPLIT_TICKET_ID,
    message: "A new ticket was created from the selected items.",
  });
});
