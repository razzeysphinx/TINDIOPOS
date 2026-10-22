import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedSyncPushDependencies } from "../dist/src/pos/sync-push-runtime.js";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const EMPLOYEE_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const STORE_ID = "44444444-4444-4444-8444-444444444444";
const REGISTER_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const PAYMENT_METHOD_ID = "77777777-7777-4777-8777-777777777777";
const SALE_ID = "88888888-8888-4888-8888-888888888888";
const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const CORE = {
  ok: true,
  profileId: PROFILE_ID,
  organization: {
    id: ORGANIZATION_ID,
    name: "Razzey Trading Corp.",
    currencyCode: "PHP",
    timezone: "Asia/Manila",
    status: "active",
    businessType: "retail",
    deviceManagementEnabled: true,
  },
  employee: {
    id: EMPLOYEE_ID,
    employeeNumber: "EMP-001",
    jobTitle: "Cashier",
    name: "Razzey Sphinx",
  },
  availableOrganizations: [{ id: ORGANIZATION_ID, name: "Razzey Trading Corp.", status: "active" }],
  roleNames: ["Cashier"],
  permissions: ["pos.access", "sales.create", "payments.accept"],
  storeIds: [STORE_ID],
  features: { open_tickets: true },
};

const DEVICE = {
  deviceId: DEVICE_ID,
  secret: "a".repeat(64),
  appVersion: "mobile-1.0.0",
};

const CHECKOUT = {
  storeId: STORE_ID,
  registerId: REGISTER_ID,
  idempotencyKey: "99999999-9999-4999-8999-999999999999",
  customerId: null,
  loyaltyRedemptionPoints: 0,
  discountId: null,
  taxRateId: null,
  diningOptionId: null,
  openTicketId: null,
  offlineExpectedTotalMinor: 1500,
  items: [{
    productId: PRODUCT_ID,
    variantId: null,
    quantity: 1,
    unitPriceMinor: 1500,
    modifierOptionIds: [],
    itemNote: null,
  }],
  payments: [{
    paymentMethodId: PAYMENT_METHOD_ID,
    tenderedAmount: "20.00",
    referenceNumber: "",
    note: "local cash",
  }],
};

const OFFLINE = {
  localReceiptReference: "OFF-ABC123",
  createdAt: "2026-10-22T08:00:00.000Z",
  shiftId: SHIFT_ID,
  deviceId: DEVICE_ID,
  deviceSequence: 1,
};

test("sync-push runtime verifies Auth separately and sends every database operation only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedSyncPushDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request.clone());
      const path = new URL(request.url).pathname;
      if (path.endsWith("/get_pos_bootstrap_core_v2")) return Response.json(CORE);
      if (path.endsWith("/validate_pos_device")) {
        return Response.json([{
          device_id: DEVICE_ID,
          store_id: STORE_ID,
          register_id: REGISTER_ID,
          device_name: "Counter 1",
          app_version: DEVICE.appVersion,
        }]);
      }
      if (path.endsWith("/reserve_pos_device_sequence")) {
        return Response.json([{
          status: "ACCEPTED",
          server_checkpoint: 0,
          expected_sequence: 1,
        }]);
      }
      if (path.endsWith("/payment_methods")) {
        return Response.json({ payment_type: "CASH", offline_policy: "cash" });
      }
      if (path.endsWith("/checkout_advanced_sale")) {
        return Response.json([{
          sale_id: SALE_ID,
          receipt_number: 42,
          total_minor: 1500,
          change_minor: 500,
          payment_summary: [],
          was_replayed: false,
        }]);
      }
      if (path.endsWith("/get_checkout_stock_warning")) return Response.json(0);
      if (path.endsWith("/finalize_pos_device_sequence")) {
        return Response.json([{ server_checkpoint: 1 }]);
      }
      if (path.endsWith("/record_offline_sync_event")) return Response.json("event");
      throw new Error(`Unexpected request ${request.url}`);
    },
  });
  const token = "header.payload.signature";
  const input = {
    organizationId: ORGANIZATION_ID,
    device: DEVICE,
    events: [{
      eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      operationType: "SALE_COMPLETED",
      checkout: CHECKOUT,
      offline: OFFLINE,
    }],
  };

  await runtime.loadCore(token, ORGANIZATION_ID);
  await runtime.validateDevice(token, ORGANIZATION_ID, input);
  const processed = await runtime.processOfflineCheckout(
    token,
    { sub: "subject" },
    CORE,
    { checkout: CHECKOUT, device: DEVICE, offline: OFFLINE },
  );

  assert.equal(processed.status, 200);
  assert.equal(processed.result.ok, true);
  assert.equal(observed.length, 9);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  const paths = observed.map((request) => new URL(request.url).pathname);
  assert.deepEqual(paths, [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/validate_pos_device",
    "/rest/v1/rpc/validate_pos_device",
    "/rest/v1/rpc/reserve_pos_device_sequence",
    "/rest/v1/payment_methods",
    "/rest/v1/rpc/checkout_advanced_sale",
    "/rest/v1/rpc/get_checkout_stock_warning",
    "/rest/v1/rpc/finalize_pos_device_sequence",
    "/rest/v1/rpc/record_offline_sync_event",
  ]);
  for (const index of [1, 2, 3, 4, 5, 7, 8]) {
    assert.equal(observed[index].headers.get("x-tindio-device-id"), DEVICE_ID);
  }
  assert.equal(observed[0].headers.get("x-tindio-device-id"), null);
  assert.equal(observed[6].headers.get("x-tindio-device-id"), null);
});
