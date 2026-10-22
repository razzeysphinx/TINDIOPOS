import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedRefundDependencies } from "../dist/src/pos/refund-runtime.js";

test("refund runtime sends receipt custody and mutation RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedRefundDependencies({
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
  await runtime.loadReceiptDetail(token, "organization", "receipt");
  await runtime.refund(token, "organization", {
    saleId: "sale",
    paymentMethodId: "payment",
    idempotencyKey: "key",
    reason: "Return",
    referenceNumber: "",
    items: [{ saleItemId: "item", quantity: 1, returnToStock: true }],
  });

  assert.equal(observed.length, 3);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/get_pos_receipt_detail",
    "/rest/v1/rpc/refund_sale",
  ]);
  assert.deepEqual(JSON.parse(await observed[2].text()), {
    target_organization_id: "organization",
    target_sale_id: "sale",
    target_payment_method_id: "payment",
    target_idempotency_key: "key",
    target_reason: "Return",
    target_reference_number: null,
    target_items: [{ sale_item_id: "item", quantity: 1, return_to_stock: true }],
  });
});
