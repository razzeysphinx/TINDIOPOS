import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedCustomersDependencies } from "../dist/src/pos/customers-runtime.js";

test("customers runtime sends all database reads only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedCustomersDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observed.push(request);
      const url = new URL(request.url);
      if (url.pathname.endsWith("/shifts")) return Response.json({ id: "shift" });
      if (url.pathname.endsWith("/search_pos_customers")) return Response.json([]);
      return Response.json({ ok: true });
    },
  });

  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.findActiveShift(token, "organization", "store", "employee");
  await runtime.searchCustomers(token, "organization", {
    store: "store",
    query: "Ana",
  });

  assert.equal(observed.length, 3);
  assert.deepEqual(
    observed.map((request) => new URL(request.url).origin),
    ["https://data.example.test", "https://data.example.test", "https://data.example.test"],
  );
  for (const request of observed) {
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }

  assert.equal(
    observed[0].url,
    "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2",
  );
  assert.match(observed[1].url, /\/rest\/v1\/shifts\?/);
  assert.match(observed[1].url, /organization_id=eq\.organization/);
  assert.match(observed[1].url, /store_id=eq\.store/);
  assert.match(observed[1].url, /opened_by_employee_id=eq\.employee/);
  assert.match(observed[1].url, /status=eq\.open/);
  assert.equal(
    observed[2].url,
    "https://data.example.test/rest/v1/rpc/search_pos_customers",
  );
  assert.deepEqual(JSON.parse(await observed[2].text()), {
    target_organization_id: "organization",
    target_store_id: "store",
    target_query: "Ana",
    target_limit: 8,
  });
});
