import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedFavoriteTileDependencies } from "../dist/src/pos/favorite-tile-runtime.js";

test("favorite-tile runtime sends both RPC calls only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedFavoriteTileDependencies({
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
  await runtime.updateFavorite(token, "organization", {
    storeId: "store",
    productId: "product",
    variantId: null,
    isFavorite: true,
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
    "https://data.example.test/rest/v1/rpc/set_pos_favorite_tile",
  );
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_store_id: "store",
    target_product_id: "product",
    target_variant_id: null,
    target_is_favorite: true,
  });
});
