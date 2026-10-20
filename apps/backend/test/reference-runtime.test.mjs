import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedReferenceDependencies } from "../dist/src/pos/reference-runtime.js";

test("reference runtime sends its bearer-authorized RPC only to Neon", async () => {
  let observedRequest;
  const runtime = createOwnedReferenceDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observedRequest = request;
      return Response.json({ ok: false, reason: "IDENTITY_UNMAPPED" });
    },
  });

  const result = await runtime.loadReference(
    "header.payload.signature",
    "11111111-1111-4111-8111-111111111111",
  );

  assert.equal(
    observedRequest.url,
    "https://data.example.test/rest/v1/rpc/get_pos_reference_bundle_v2",
  );
  assert.equal(observedRequest.method, "POST");
  assert.equal(observedRequest.headers.get("apikey"), null);
  assert.equal(
    observedRequest.headers.get("authorization"),
    "Bearer header.payload.signature",
  );
  assert.deepEqual(JSON.parse(await observedRequest.text()), {
    target_organization_id: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.error, null);
});
