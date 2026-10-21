import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedOpenTicketMoveLinesDependencies } from "../dist/src/pos/open-ticket-move-lines-runtime.js";

test("open-ticket line-movement runtime sends context and credential-bound RPC only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedOpenTicketMoveLinesDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json(request.url.includes("/move_open_ticket_lines") ? null : { ok: true });
    },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.moveLines(token, "organization", {
    sourceTicketId: "77777777-7777-4777-8777-777777777777",
    destinationTicketId: "88888888-8888-4888-8888-888888888888",
    lines: [{ ticketLineId: "66666666-6666-4666-8666-666666666666", quantity: 1.125 }],
    device: {
      deviceId: "44444444-4444-4444-8444-444444444444",
      secret: "a".repeat(64),
      appVersion: "mobile-1.0.0",
    },
  });

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.equal(observed[0].url, "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2");
  assert.equal(observed[1].url, "https://data.example.test/rest/v1/rpc/move_open_ticket_lines");
  assert.equal(observed[1].headers.get("x-tindio-device-id"), "44444444-4444-4444-8444-444444444444");
  assert.equal(observed[1].headers.get("x-tindio-device-secret"), "a".repeat(64));
  assert.equal(observed[1].headers.get("x-tindio-app-version"), "mobile-1.0.0");
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_source_ticket_id: "77777777-7777-4777-8777-777777777777",
    target_destination_ticket_id: "88888888-8888-4888-8888-888888888888",
    target_lines: [{
      ticket_line_id: "66666666-6666-4666-8666-666666666666",
      quantity: 1.125,
    }],
  });
});
