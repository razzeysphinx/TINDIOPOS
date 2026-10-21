import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN_TICKET_MERGE_COMPATIBILITY_CONTRACT,
  mapOpenTicketMergeRpcResult,
  toOpenTicketMergeRpcArguments,
  validateOpenTicketMerge,
} from "../dist/src/pos/open-ticket-merge-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const SOURCE_TICKET_ID = "10000000-0000-4000-8000-000000000001";
const DESTINATION_TICKET_ID = "20000000-0000-4000-8000-000000000001";
const DEVICE_ID = "50000000-0000-4000-8000-000000000001";

const CONTEXT = {
  permissions: ["pos.access", "sales.create", "tickets.manage"],
  openTicketsEnabled: true,
};

const VALID_INPUT = {
  sourceTicketId: SOURCE_TICKET_ID,
  destinationTicketId: DESTINATION_TICKET_ID,
  device: {
    deviceId: DEVICE_ID,
    secret: "a".repeat(64),
    appVersion: "  android-1.0.0  ",
  },
};

test("open-ticket merge freezes route, dual-ticket custody, source retention, audit, and RPC", () => {
  assert.deepEqual(OPEN_TICKET_MERGE_COMPATIBILITY_CONTRACT, {
    method: "POST",
    path: "/api/pos/v2/tickets/merge",
    permissions: ["pos.access", "sales.create", "tickets.manage"],
    feature: "open_tickets",
    rpc: "merge_open_tickets",
    rpcArguments: [
      "target_organization_id",
      "target_source_ticket_id",
      "target_destination_ticket_id",
    ],
    ticketScope: "organization-open-source-and-destination",
    registerScope: "same-store-and-register",
    requiresOwnedOpenShift: true,
    databaseOnlyValidation: [
      "distinct-source-and-destination",
      "source-still-open",
      "destination-still-open",
      "destination-maximum-100-lines",
    ],
    sourceLineBehavior: "move-all-lines-and-preserve-audit-cart",
    destinationLineBehavior: "append-source-lines-preserving-line-identifiers",
    sourceStatusAfterMerge: "merged-with-destination-reference",
    audit: { event: "OPEN_TICKETS_MERGED", action: "ticket.merge" },
    actionResponse: { status: 200, headers: { "cache-control": "private, no-store" } },
    malformedJsonResponse: {
      status: 400,
      headers: { "cache-control": "private, no-store" },
      body: { ok: false, message: "The request data is invalid." },
    },
  });
});

test("open-ticket merge normalizes device versions and strips extras", () => {
  const result = validateOpenTicketMerge({ ...VALID_INPUT, ignored: "strip-me" }, CONTEXT);
  assert.equal(result.ok, true);
  assert.equal(result.input.device.appVersion, "android-1.0.0");
  assert.equal("ignored" in result.input, false);
});

test("open-ticket merge accepts absent or null device credentials", () => {
  for (const input of [
    { ...VALID_INPUT, device: undefined },
    { ...VALID_INPUT, device: null },
  ]) assert.equal(validateOpenTicketMerge(input, CONTEXT).ok, true);
});

test("open-ticket merge rejects missing capabilities and feature", () => {
  for (const context of [
    { ...CONTEXT, permissions: ["pos.access", "sales.create"] },
    { ...CONTEXT, openTicketsEnabled: false },
  ]) {
    assert.deepEqual(validateOpenTicketMerge(VALID_INPUT, context), {
      ok: false,
      result: { ok: false, message: "Choose two different open tickets." },
    });
  }
});

test("open-ticket merge rejects invalid ticket and device shapes", () => {
  for (const input of [
    null,
    {},
    { ...VALID_INPUT, sourceTicketId: "bad" },
    { ...VALID_INPUT, destinationTicketId: "bad" },
    { ...VALID_INPUT, device: { deviceId: "bad", secret: "bad", appVersion: "" } },
  ]) {
    assert.deepEqual(validateOpenTicketMerge(input, CONTEXT), {
      ok: false,
      result: { ok: false, message: "Choose two different open tickets." },
    });
  }
});

test("open-ticket merge preserves database-only distinct-ticket validation", () => {
  assert.equal(validateOpenTicketMerge({
    ...VALID_INPUT,
    destinationTicketId: SOURCE_TICKET_ID,
  }, CONTEXT).ok, true);
});

test("open-ticket merge maps the exact normalized RPC argument projection", () => {
  const validation = validateOpenTicketMerge(VALID_INPUT, CONTEXT);
  assert.equal(validation.ok, true);
  assert.deepEqual(toOpenTicketMergeRpcArguments(ORGANIZATION_ID, validation.input), {
    target_organization_id: ORGANIZATION_ID,
    target_source_ticket_id: SOURCE_TICKET_ID,
    target_destination_ticket_id: DESTINATION_TICKET_ID,
  });
});

test("open-ticket merge maps permission, device, constraint, missing-source, and provider failures", () => {
  for (const [error, message] of [
    [{ code: "42501", message: "Sales permission is required." }, "You do not have permission to change these tickets."],
    [{ code: "42501", message: "This device is unavailable." }, "This device is unavailable."],
    [{ code: "23514", message: "Both tickets must be open on the same register." }, "Both tickets must be open on the same register."],
    [{ code: "P0002", message: "The source ticket is no longer open." }, "TINDIO could not save the ticket change. Nothing was moved."],
    [{ code: "XX000", message: "provider detail" }, "TINDIO could not save the ticket change. Nothing was moved."],
  ]) assert.deepEqual(mapOpenTicketMergeRpcResult(error), { ok: false, message });
});

test("open-ticket merge maps the exact success envelope", () => {
  assert.deepEqual(mapOpenTicketMergeRpcResult(null), {
    ok: true,
    message: "Tickets merged. The original source ticket remains in the audit history.",
  });
});
