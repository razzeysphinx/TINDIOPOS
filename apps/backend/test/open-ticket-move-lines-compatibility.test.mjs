import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_TICKET_MOVE_LINES_COMPATIBILITY_CONTRACT,
  mapOpenTicketMoveLinesRpcResult,
  toOpenTicketMoveLinesRpcArguments,
  validateOpenTicketMoveLines,
} from "../dist/src/pos/open-ticket-move-lines-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SOURCE_TICKET_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_TICKET_ID = "20000000-0000-4000-8000-000000000001";
const LINE_ID = "30000000-0000-4000-8000-000000000001";
const DEVICE_ID = "50000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: ["pos.access", "sales.create", "tickets.manage"],
  openTicketsEnabled: true,
};

const VALID_INPUT = {
  sourceTicketId: SOURCE_TICKET_ID,
  destinationTicketId: DESTINATION_TICKET_ID,
  lines: [{ ticketLineId: LINE_ID, quantity: 1.125 }],
  device: {
    deviceId: DEVICE_ID,
    secret: "a".repeat(64),
    appVersion: "  android-1.0.0  ",
  },
};

test("open-ticket line movement freezes route, scope, line rules, audit, and RPC", () => {
  assert.deepEqual(OPEN_TICKET_MOVE_LINES_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/tickets/move-lines",
    permissions: ["pos.access", "sales.create", "tickets.manage"],
    feature: "open_tickets",
    rpc: "move_open_ticket_lines",
    rpcArguments: [
      "target_organization_id",
      "target_source_ticket_id",
      "target_destination_ticket_id",
      "target_lines",
    ],
    ticketScope: "organization-open-tickets-on-same-store-and-register",
    requiresOwnedOpenShift: true,
    lineBounds: {
      minimumLines: 1,
      maximumLines: 100,
      minimumQuantity: 0.001,
      maximumQuantity: 10_000,
      quantityScale: 3,
    },
    databaseOnlyValidation: [
      "distinct-source-and-destination",
      "unique-line-identifiers",
      "line-still-present",
      "quantity-not-above-saved",
      "same-open-register",
      "destination-maximum-100-lines",
      "source-retains-at-least-one-line",
    ],
    partialLineBehavior: "clone-with-new-ticket-line-id",
    audit: { event: "OPEN_TICKET_LINES_MOVED", action: "ticket.move" },
    actionResponse: { status: 200, headers: { "cache-control": "private, no-store" } },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("open-ticket line movement normalizes device input and strips extras", () => {
  const result = validateOpenTicketMoveLines({
    ...VALID_INPUT,
    ignored: "strip-me",
    lines: [{ ...VALID_INPUT.lines[0], ignored: "strip-me" }],
  }, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.input.device.appVersion, "android-1.0.0");
  assert.equal("ignored" in result.input, false);
  assert.equal("ignored" in result.input.lines[0], false);
});

test("open-ticket line movement accepts absent or null device credentials", () => {
  for (const input of [
    { ...VALID_INPUT, device: undefined },
    { ...VALID_INPUT, device: null },
  ]) assert.equal(validateOpenTicketMoveLines(input, CONTEXT).ok, true);
});

test("open-ticket line movement rejects missing capabilities and feature", () => {
  for (const context of [
    { ...CONTEXT, permissions: ["pos.access", "sales.create"] },
    { ...CONTEXT, openTicketsEnabled: false },
  ]) {
    assert.deepEqual(validateOpenTicketMoveLines(VALID_INPUT, context), {
      ok: false,
      result: { ok: false, message: "Choose valid source, destination, and ticket lines." },
    });
  }
});

test("open-ticket line movement rejects invalid tickets, line bounds, quantity, and custody", () => {
  for (const input of [
    null,
    {},
    { ...VALID_INPUT, sourceTicketId: "bad" },
    { ...VALID_INPUT, destinationTicketId: "bad" },
    { ...VALID_INPUT, lines: [] },
    { ...VALID_INPUT, lines: Array.from({ length: 101 }, (_, index) => ({ ...VALID_INPUT.lines[0], quantity: index + 1 })) },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], ticketLineId: "bad" }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], quantity: 0 }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], quantity: 10_001 }] },
    { ...VALID_INPUT, lines: [{ ...VALID_INPUT.lines[0], quantity: 1.0001 }] },
    { ...VALID_INPUT, device: { deviceId: "bad", secret: "bad", appVersion: "" } },
  ]) {
    assert.deepEqual(validateOpenTicketMoveLines(input, CONTEXT), {
      ok: false,
      result: { ok: false, message: "Choose valid source, destination, and ticket lines." },
    });
  }
});

test("open-ticket line movement preserves database-only pair and duplicate validation", () => {
  for (const input of [
    { ...VALID_INPUT, destinationTicketId: SOURCE_TICKET_ID },
    { ...VALID_INPUT, lines: [VALID_INPUT.lines[0], VALID_INPUT.lines[0]] },
  ]) assert.equal(validateOpenTicketMoveLines(input, CONTEXT).ok, true);
});

test("open-ticket line movement maps the exact RPC argument projection", () => {
  const validation = validateOpenTicketMoveLines(VALID_INPUT, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(toOpenTicketMoveLinesRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_source_ticket_id: SOURCE_TICKET_ID,
    target_destination_ticket_id: DESTINATION_TICKET_ID,
    target_lines: [{ ticket_line_id: LINE_ID, quantity: 1.125 }],
  });
});

test("open-ticket line movement maps permission, device, constraint, missing-line, and provider failures", () => {
  for (const [error, message] of [
    [{ code: "42501", message: "Sales permission is required." }, "You do not have permission to change these tickets."],
    [{ code: "42501", message: "This device is unavailable." }, "This device is unavailable."],
    [{ code: "23514", message: "Both tickets must be open on the same register." }, "Both tickets must be open on the same register."],
    [{ code: "P0002", message: "One or more selected ticket items are no longer available." }, "TINDIO could not save the ticket change. Nothing was moved."],
    [{ code: "XX000", message: "provider detail" }, "TINDIO could not save the ticket change. Nothing was moved."],
  ]) assert.deepEqual(mapOpenTicketMoveLinesRpcResult(error), { ok: false, message });
});

test("open-ticket line movement maps the exact success envelope", () => {
  assert.deepEqual(mapOpenTicketMoveLinesRpcResult(null), {
    ok: true,
    message: "Selected items moved to the destination ticket.",
  });
});
