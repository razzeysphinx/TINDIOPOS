import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedCustomerCreationDependencies } from "../dist/src/pos/customer-creation-runtime.js";

test("customer-creation runtime sends context and direct insert only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedCustomerCreationDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request);
      return request.url.includes("/customers")
        ? Response.json({
            id: "11111111-1111-4111-8111-111111111111",
            customer_number: 1,
            loyalty_card_code: "TND-00000001",
            full_name: "Ada",
            email: null,
            phone: null,
          })
        : Response.json({ ok: true });
    },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.createCustomer(token, "organization", {
    fullName: "Ada",
    email: "",
    phone: "",
    address: "",
    birthday: "",
    notes: "",
    loyaltyCardCode: "",
  });

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.equal(observed[0].url, "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2");
  assert.match(observed[1].url, /^https:\/\/data\.example\.test\/rest\/v1\/customers\?/);
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    organization_id: "organization",
    full_name: "Ada",
    email: null,
    phone: null,
    address: null,
    birthday: null,
    notes: null,
  });
  assert.match(observed[1].headers.get("prefer"), /return=representation/);
});
