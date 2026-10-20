import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedLiveDependencies } from "../dist/src/pos/live-runtime.js";

test("live runtime sends its bounded RPC read only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedLiveDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json({});
    },
  });

  const token = "header.payload.signature";
  await runtime.loadLive(token, "organization", "store", "register");

  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, "https://data.example.test/rest/v1/rpc/get_pos_live_state_v2");
  assert.equal(observed[0].headers.get("apikey"), null);
  assert.equal(observed[0].headers.get("authorization"), `Bearer ${token}`);
  assert.deepEqual(JSON.parse(await observed[0].text()), {
    target_organization_id: "organization",
    target_store_id: "store",
    target_register_id: "register",
  });
});
