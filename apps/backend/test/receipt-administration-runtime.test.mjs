import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedReceiptAdministrationDependencies } from "../dist/src/pos/receipt-administration-runtime.js";

test("receipt-administration runtime sends context and both mutation RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedReceiptAdministrationDependencies({
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
  await runtime.updateSettings(token, "organization", {
    businessName: "Business", businessAddress: "", businessPhone: "", businessEmail: "",
    businessTaxId: "", businessWebsite: "", headerMessage: "", footerMessage: "Thanks",
    paperWidthMm: 80, showStoreAddress: true, showStorePhone: true, showCashier: true,
    showRegister: true, showPaymentDetails: true,
  });
  await runtime.queueDelivery(token, "organization", {
    receiptId: "receipt", recipient: "customer@example.com", idempotencyKey: "key",
  });

  assert.equal(observed.length, 3);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/update_receipt_settings",
    "/rest/v1/rpc/queue_receipt_delivery",
  ]);
  assert.equal(JSON.parse(await observed[1].text()).target_organization_id, "organization");
  assert.deepEqual(JSON.parse(await observed[2].text()), {
    target_organization_id: "organization",
    target_receipt_id: "receipt",
    target_delivery_channel: "EMAIL",
    target_recipient: "customer@example.com",
    target_idempotency_key: "key",
  });
});
