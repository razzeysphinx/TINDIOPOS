import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedCheckoutDependencies } from "../dist/src/pos/checkout-runtime.js";

test("checkout runtime sends context, checkout, and warning RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedCheckoutDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request.clone());
      if (request.url.includes("/checkout_advanced_sale")) return Response.json([]);
      if (request.url.includes("/get_checkout_stock_warning")) return Response.json(2);
      return Response.json({ ok: true });
    },
  });
  const token = "header.payload.signature";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const storeId = "44444444-4444-4444-8444-444444444444";
  const saleId = "88888888-8888-4888-8888-888888888888";
  await runtime.loadCore(token, organizationId);
  await runtime.checkout(token, organizationId, {
    storeId,
    registerId: "55555555-5555-4555-8555-555555555555",
    idempotencyKey: "99999999-9999-4999-8999-999999999999",
    customerId: null,
    loyaltyRedemptionPoints: 0,
    discountId: null,
    taxRateId: null,
    diningOptionId: null,
    openTicketId: null,
    items: [{ productId: "66666666-6666-4666-8666-666666666666", variantId: null, quantity: 1, modifierOptionIds: [] }],
    payments: [{ paymentMethodId: "77777777-7777-4777-8777-777777777777", tenderedAmount: "20.00", referenceNumber: "", note: "" }],
  }, {
    deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    secret: "a".repeat(64),
    appVersion: "mobile-1.0.0",
  });
  await runtime.loadStockWarning(token, organizationId, storeId, saleId);

  assert.equal(observed.length, 3);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.equal(observed[0].url, "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2");
  assert.equal(observed[1].url, "https://data.example.test/rest/v1/rpc/checkout_advanced_sale");
  assert.equal(observed[2].url, "https://data.example.test/rest/v1/rpc/get_checkout_stock_warning");
  assert.equal(observed[1].headers.get("x-tindio-device-id"), "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(observed[2].headers.get("x-tindio-device-id"), null);
  assert.deepEqual(JSON.parse(await observed[2].text()), {
    target_organization_id: organizationId,
    target_store_id: storeId,
    target_sale_id: saleId,
  });
});
