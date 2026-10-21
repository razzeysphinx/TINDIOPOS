import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedOpenTicketSaveDependencies } from "../dist/src/pos/open-ticket-save-runtime.js";

test("open-ticket save runtime sends context and credential-bound RPC only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedOpenTicketSaveDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request);
      return request.url.includes("/save_open_ticket_v2")
        ? Response.json([{ ticket_id: "77777777-7777-4777-8777-777777777777" }])
        : Response.json({ ok: true });
    },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.saveTicket(token, "organization", {
    storeId: "11111111-1111-4111-8111-111111111111",
    registerId: "22222222-2222-4222-8222-222222222222",
    ticketId: null,
    customerId: null,
    diningOptionId: null,
    assignedEmployeeId: null,
    label: "Table 7",
    note: "",
    cart: [{
      productId: "33333333-3333-4333-8333-333333333333",
      variantId: null,
      quantity: 1,
      modifierOptionIds: [],
      productName: "Iced tea",
      variantName: null,
      sku: "TEA-1",
      barcode: null,
      categoryId: null,
      priceMinor: 12500,
      unit: "glass",
      isVariablePrice: false,
      allowFractionalQuantity: false,
      manualPriceMinor: null,
    }],
    device: {
      deviceId: "44444444-4444-4444-8444-444444444444",
      secret: "a".repeat(64),
      appVersion: "mobile-1.0.0",
    },
  });

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.equal(observed[0].url, "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2");
  assert.equal(observed[1].url, "https://data.example.test/rest/v1/rpc/save_open_ticket_v2");
  assert.equal(observed[1].headers.get("x-tindio-device-id"), "44444444-4444-4444-8444-444444444444");
  assert.equal(observed[1].headers.get("x-tindio-device-secret"), "a".repeat(64));
  assert.equal(observed[1].headers.get("x-tindio-app-version"), "mobile-1.0.0");
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_store_id: "11111111-1111-4111-8111-111111111111",
    target_register_id: "22222222-2222-4222-8222-222222222222",
    target_ticket_id: null,
    target_customer_id: null,
    target_dining_option_id: null,
    target_assigned_employee_id: null,
    target_label: "Table 7",
    target_note: null,
    target_cart: [{
      product_id: "33333333-3333-4333-8333-333333333333",
      variant_id: null,
      quantity: 1,
      unit_price_minor: null,
      modifier_option_ids: [],
      item_note: null,
      productName: "Iced tea",
      variantName: null,
      sku: "TEA-1",
      barcode: null,
      categoryId: null,
      priceMinor: 12500,
      unit: "glass",
      imageUrl: null,
      isVariablePrice: false,
      allowFractionalQuantity: false,
      manualPriceMinor: null,
      modifiers: [],
    }],
  });
});
