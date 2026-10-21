import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_TICKET_CANCEL_COMPATIBILITY_CONTRACT,
  mapOpenTicketCancelRpcResult,
  toOpenTicketCancelRpcArguments,
  validateOpenTicketCancel,
} from "../dist/src/pos/open-ticket-cancel-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const TICKET_ID = "40000000-0000-4000-8000-000000000001";
const DEVICE_ID = "50000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: ["pos.access", "sales.create", "tickets.manage"],
  openTicketsEnabled: true,
};

const VALID_INPUT = {
  ticketId: TICKET_ID,
  device: {
    deviceId: DEVICE_ID,
    secret: "a".repeat(64),
    appVersion: "  android-1.0.0  ",
  },
};

test("open-ticket cancel compatibility freezes route, custody, repetition, and RPC", () => {
  assert.deepEqual(OPEN_TICKET_CANCEL_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/tickets/cancel",
    permissions: ["pos.access", "sales.create", "tickets.manage"],
    feature: "open_tickets",
    rpc: "cancel_open_ticket",
    rpcArguments: ["target_organization_id", "target_ticket_id"],
    ticketScope: "organization-open-ticket",
    storeScope: "derived-from-ticket",
    requiresOwnedOpenShift: true,
    repeatedCancel: "fails-closed-as-unavailable",
    actionResponse: { status: 200, headers: { "cache-control": "private, no-store" } },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("open-ticket cancel compatibility normalizes device input and strips extras", () => {
  const result = validateOpenTicketCancel({ ...VALID_INPUT, ignored: "strip-me" }, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.input.device.appVersion, "android-1.0.0");
  assert.equal("ignored" in result.input, false);
});

test("open-ticket cancel compatibility accepts absent or null device credentials", () => {
  for (const input of [
    { ticketId: TICKET_ID },
    { ticketId: TICKET_ID, device: null },
  ]) {
    assert.equal(validateOpenTicketCancel(input, CONTEXT).ok, true);
  }
});

test("open-ticket cancel compatibility rejects missing capabilities and feature", () => {
  for (const context of [
    { ...CONTEXT, permissions: ["pos.access", "sales.create"] },
    { ...CONTEXT, openTicketsEnabled: false },
  ]) {
    assert.deepEqual(validateOpenTicketCancel(VALID_INPUT, context), {
      ok: false,
      result: { ok: false, message: "This ticket is unavailable." },
    });
  }
});

test("open-ticket cancel compatibility rejects invalid ticket and device custody", () => {
  for (const input of [
    null,
    {},
    { ticketId: "bad" },
    { ...VALID_INPUT, device: { deviceId: "bad", secret: "bad", appVersion: "" } },
    { ...VALID_INPUT, device: { ...VALID_INPUT.device, secret: "g".repeat(64) } },
  ]) {
    assert.deepEqual(validateOpenTicketCancel(input, CONTEXT), {
      ok: false,
      result: { ok: false, message: "This ticket is unavailable." },
    });
  }
});

test("open-ticket cancel compatibility maps the exact RPC argument projection", () => {
  const validation = validateOpenTicketCancel(VALID_INPUT, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(toOpenTicketCancelRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_ticket_id: TICKET_ID,
  });
});

test("open-ticket cancel compatibility maps permission, device, constraint, repeat, and provider failures", () => {
  for (const [error, message] of [
    [{ code: "42501", message: "Sales permission is required." }, "You do not have permission to change these tickets."],
    [{ code: "42501", message: "This device is unavailable." }, "This device is unavailable."],
    [{ code: "23514", message: "The shift cannot accept ticket changes." }, "The shift cannot accept ticket changes."],
    [{ code: "P0002", message: "This open ticket is no longer available." }, "TINDIO could not save the ticket change. Nothing was moved."],
    [{ code: "XX000", message: "provider detail" }, "TINDIO could not save the ticket change. Nothing was moved."],
  ]) {
    assert.deepEqual(mapOpenTicketCancelRpcResult(error), { ok: false, message });
  }
});

test("open-ticket cancel compatibility maps the exact success envelope", () => {
  assert.deepEqual(mapOpenTicketCancelRpcResult(null), {
    ok: true,
    message: "Ticket cancelled.",
  });
});
