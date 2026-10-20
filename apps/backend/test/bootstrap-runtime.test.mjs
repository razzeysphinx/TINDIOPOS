import assert from "node:assert/strict";
import test from "node:test";

import { createNeonDataApiFetch } from "../dist/src/database/neon-data-api-fetch.js";
import { createOwnedBootstrapDependencies } from "../dist/src/pos/bootstrap-runtime.js";

test("Neon Data API adapter rewrites only database requests", async () => {
  const observed = [];
  const adaptedFetch = createNeonDataApiFetch({
    supabaseUrl: "https://auth.example.test",
    neonDataApiUrl: "https://data.example.test/rest/v1",
    fetchImpl: async (request) => {
      observed.push(request);
      return new Response(null, { status: 204 });
    },
  });

  await adaptedFetch("https://auth.example.test/auth/v1/.well-known/jwks.json", {
    headers: { apikey: "publishable-key" },
  });
  await adaptedFetch("https://auth.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2?select=*", {
    method: "POST",
    headers: {
      apikey: "publishable-key",
      authorization: "Bearer header.payload.signature",
    },
  });

  assert.equal(observed[0].url, "https://auth.example.test/auth/v1/.well-known/jwks.json");
  assert.equal(observed[0].headers.get("apikey"), "publishable-key");
  assert.equal(
    observed[1].url,
    "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2?select=*",
  );
  assert.equal(observed[1].headers.get("apikey"), null);
  assert.equal(observed[1].headers.get("authorization"), "Bearer header.payload.signature");
});

test("owned runtime fails closed when required provider configuration is absent", () => {
  for (const environment of [
    {},
    {
      SUPABASE_URL: "file:///auth",
      SUPABASE_PUBLISHABLE_KEY: "key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "key",
      NEON_DATA_API_URL: "https://user:password@data.example.test/rest/v1",
    },
  ]) {
    assert.throws(() => createOwnedBootstrapDependencies({
      environment,
      createRequestId: () => "id",
    }));
  }
});

test("owned runtime sends only bearer-authorized RPC traffic to Neon", async () => {
  let observedRequest;
  const runtime = createOwnedBootstrapDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observedRequest = request;
      return Response.json({
        ok: true,
        permissions: ["pos.access", "sales.create"],
      });
    },
  });

  const result = await runtime.loadCore(
    "header.payload.signature",
    "11111111-1111-4111-8111-111111111111",
  );

  assert.equal(
    observedRequest.url,
    "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2",
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
  assert.equal(result.data.ok, true);
});
