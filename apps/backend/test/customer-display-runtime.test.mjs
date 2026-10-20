import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedCustomerDisplayDependencies } from "../dist/src/pos/customer-display-runtime.js";

test("customer-display runtime sends both RPC calls only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedCustomerDisplayDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json({ ok: true });
    },
  });

  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.updateDisplay(token, "organization", {
    sessionId: "session",
    state: {
      status: "idle",
      items: [],
      subtotalMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      payments: [],
      customer: null,
      saleId: null,
      receiptNumber: null,
      changeMinor: 0,
      updatedAt: "2026-10-20T10:00:00.000Z",
    },
  });

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.equal(
    observed[0].url,
    "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2",
  );
  assert.equal(
    observed[1].url,
    "https://data.example.test/rest/v1/rpc/set_customer_display_state",
  );
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_session_id: "session",
    target_state: {
      status: "idle",
      items: [],
      subtotalMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      payments: [],
      customer: null,
      saleId: null,
      receiptNumber: null,
      changeMinor: 0,
      updatedAt: "2026-10-20T10:00:00.000Z",
    },
  });
});
