import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedOfflineCheckoutDependencies } from "../dist/src/pos/offline-checkout-runtime.js";

test("offline-checkout runtime sends every database operation only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedOfflineCheckoutDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request.clone());
      if (request.url.includes("/payment_methods")) {
        return Response.json([{ payment_type: "CASH", offline_policy: "cash" }]);
      }
      return Response.json([]);
    },
  });
  const token = "header.payload.signature";
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const storeId = "44444444-4444-4444-8444-444444444444";
  const registerId = "55555555-5555-4555-8555-555555555555";
  const paymentMethodId = "77777777-7777-4777-8777-777777777777";
  const saleId = "88888888-8888-4888-8888-888888888888";
  const device = {
    deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    secret: "a".repeat(64),
    appVersion: "mobile-1.0.0",
  };
  const checkout = {
    storeId,
    registerId,
    idempotencyKey: "99999999-9999-4999-8999-999999999999",
    customerId: null,
    loyaltyRedemptionPoints: 0,
    discountId: null,
    taxRateId: null,
    diningOptionId: null,
    openTicketId: null,
    offlineExpectedTotalMinor: 1500,
    items: [{
      productId: "66666666-6666-4666-8666-666666666666",
      variantId: null,
      quantity: 1,
      unitPriceMinor: 1500,
      modifierOptionIds: [],
      itemNote: null,
    }],
    payments: [{
      paymentMethodId,
      tenderedAmount: "20.00",
      referenceNumber: "",
      note: "local cash",
    }],
  };
  const offline = {
    localReceiptReference: "OFF-ABC123",
    createdAt: "2026-10-22T08:00:00.000Z",
    shiftId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    deviceId: device.deviceId,
    deviceSequence: 7,
  };
  const intent = { kind: "required", device, offline, checkout };
  const body = { checkout, device, offline };
  const success = {
    ok: true,
    message: "Sale complete.",
    data: {
      saleId,
      receiptNumber: 42,
      totalMinor: 1500,
      changeMinor: 500,
      payments: [],
      wasReplayed: false,
      inventoryWarning: null,
    },
  };

  await runtime.loadCore(token, organizationId);
  await runtime.validateDevice(token, organizationId, intent);
  await runtime.reserveSequence(token, organizationId, intent);
  await runtime.loadPaymentMethod(token, organizationId, paymentMethodId, device);
  await runtime.checkout(token, organizationId, checkout, device);
  await runtime.loadStockWarning(token, organizationId, storeId, saleId);
  await runtime.finalizeSequence(token, organizationId, intent, "APPLIED");
  await runtime.recordOutcome(token, organizationId, body, success, device);

  assert.equal(observed.length, 8);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  const paths = observed.map((request) => new URL(request.url).pathname);
  assert.deepEqual(paths, [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/validate_pos_device",
    "/rest/v1/rpc/reserve_pos_device_sequence",
    "/rest/v1/payment_methods",
    "/rest/v1/rpc/checkout_advanced_sale",
    "/rest/v1/rpc/get_checkout_stock_warning",
    "/rest/v1/rpc/finalize_pos_device_sequence",
    "/rest/v1/rpc/record_offline_sync_event",
  ]);
  for (const index of [1, 2, 3, 4, 6, 7]) {
    assert.equal(observed[index].headers.get("x-tindio-device-id"), device.deviceId);
  }
  assert.equal(observed[0].headers.get("x-tindio-device-id"), null);
  assert.equal(observed[5].headers.get("x-tindio-device-id"), null);
  assert.match(await observed[4].text(), /tindio-offline-total:1500/);
  assert.deepEqual(JSON.parse(await observed[6].text()), {
    target_organization_id: organizationId,
    target_device_id: device.deviceId,
    target_device_sequence: 7,
    target_idempotency_key: checkout.idempotencyKey,
    target_final_state: "APPLIED",
  });
});
