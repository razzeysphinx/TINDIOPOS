import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedCatalogDependencies } from "../dist/src/pos/catalog-runtime.js";

test("catalogue runtime sends its bearer-authorized RPC only to Neon", async () => {
  let observedRequest;
  const dependencies = createOwnedCatalogDependencies({
    environment: {
      SUPABASE_URL: "https://auth.supabase.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.neon.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observedRequest = request;
      return Response.json({ ok: true });
    },
  });

  await dependencies.loadCatalog("header.payload.signature", "organization", {
    store: "store",
    mode: "favorites",
    query: "latte",
    category: "category",
    offset: 12,
    limit: 6,
  });

  assert.equal(observedRequest.url, "https://data.neon.test/rest/v1/rpc/get_pos_catalog_v2");
  assert.equal(observedRequest.headers.get("authorization"), "Bearer header.payload.signature");
  assert.equal(observedRequest.headers.get("apikey"), null);
  assert.deepEqual(JSON.parse(await observedRequest.text()), {
    target_organization_id: "organization",
    target_store_id: "store",
    target_mode: "favorites",
    target_query: "latte",
    target_category_id: "category",
    target_offset: 12,
    target_limit: 6,
  });
});
