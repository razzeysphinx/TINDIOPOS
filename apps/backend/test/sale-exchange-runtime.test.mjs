import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedSaleExchangeDependencies } from "../dist/src/pos/sale-exchange-runtime.js";

test("sale-exchange runtime sends context and mutation RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedSaleExchangeDependencies({
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
  await runtime.link(token, "organization", {
    refundId: "refund",
    replacementReceiptNumber: 42,
    idempotencyKey: "key",
  });

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/link_sale_exchange",
  ]);
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_refund_id: "refund",
    target_replacement_receipt_number: 42,
    target_idempotency_key: "key",
  });
});
