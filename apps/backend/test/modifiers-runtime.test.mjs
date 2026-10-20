import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedModifiersDependencies } from "../dist/src/pos/modifiers-runtime.js";

test("modifiers runtime sends its bearer-authorized RPC only to Neon", async () => {
  let observedRequest;
  const runtime = createOwnedModifiersDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observedRequest = request;
      return Response.json({ ok: true });
    },
  });

  await runtime.loadModifiers("header.payload.signature", "organization", {
    store: "store",
    product: "product",
  });

  assert.equal(observedRequest.url, "https://data.example.test/rest/v1/rpc/get_pos_modifiers_v2");
  assert.equal(observedRequest.method, "POST");
  assert.equal(observedRequest.headers.get("apikey"), null);
  assert.equal(observedRequest.headers.get("authorization"), "Bearer header.payload.signature");
  assert.deepEqual(JSON.parse(await observedRequest.text()), {
    target_organization_id: "organization",
    target_store_id: "store",
    target_product_id: "product",
  });
});
