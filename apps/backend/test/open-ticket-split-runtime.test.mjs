import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedOpenTicketSplitDependencies } from "../dist/src/pos/open-ticket-split-runtime.js";

test("open-ticket split runtime sends context and credential-bound RPC only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedOpenTicketSplitDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json(request.url.includes("/split_open_ticket")
        ? "88888888-8888-4888-8888-888888888888"
        : { ok: true });
    },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.splitTicket(token, "organization", {
    sourceTicketId: "77777777-7777-4777-8777-777777777777",
    label: "Patio split",
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
  assert.equal(observed[1].url, "https://data.example.test/rest/v1/rpc/split_open_ticket");
  assert.equal(observed[1].headers.get("x-tindio-device-id"), "44444444-4444-4444-8444-444444444444");
  assert.equal(observed[1].headers.get("x-tindio-device-secret"), "a".repeat(64));
  assert.equal(observed[1].headers.get("x-tindio-app-version"), "mobile-1.0.0");
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_source_ticket_id: "77777777-7777-4777-8777-777777777777",
    target_label: "Patio split",
    target_lines: [{
      ticket_line_id: "66666666-6666-4666-8666-666666666666",
      quantity: 1.125,
    }],
  });
});
