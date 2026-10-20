import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedReceiptsDependencies } from "../dist/src/pos/receipts-runtime.js";

test("receipts runtime sends its bounded RPC reads only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedReceiptsDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json(new URL(request.url).pathname.endsWith("get_pos_receipt_history")
        ? []
        : { ok: true });
    },
  });

  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.loadReceipts(token, "organization", {
    query: "Main",
    beforeReceiptNumber: 100,
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
    "https://data.example.test/rest/v1/rpc/get_pos_receipt_history",
  );
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_query: "Main",
    target_before_receipt_number: 100,
    target_limit: 25,
  });
});

test("receipts runtime sends empty search and absent cursor as null", async () => {
  let observed;
  const runtime = createOwnedReceiptsDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observed = request;
      return Response.json([]);
    },
  });
  await runtime.loadReceipts("header.payload.signature", "organization", { query: "" });
  assert.deepEqual(JSON.parse(await observed.text()), {
    target_organization_id: "organization",
    target_query: null,
    target_before_receipt_number: null,
    target_limit: 25,
  });
});
