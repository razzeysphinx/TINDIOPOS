import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedStockOperationsDependencies } from "../dist/src/pos/stock-operations-runtime.js";

test("stock-operation runtime sends context and both RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedStockOperationsDependencies({
    environment: { SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLISHABLE_KEY: "key", NEON_DATA_API_URL: "https://data.example.test/rest/v1" },
    fetchImpl: async (request) => { observed.push(request); return Response.json({}); },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.validateCart(token, "organization", { storeId: "store", registerId: "register", items: [{ productId: "product", variantId: null, quantity: 2 }] });
  await runtime.receiveRequest(token, "organization", { operationId: "operation", stockRequestId: "request", note: "Dock", lines: [{ stockTransferLineId: "line", receivedQuantity: "2", shortQuantity: "0", discrepancyNote: "" }] });
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), ["/rest/v1/rpc/get_pos_bootstrap_core_v2", "/rest/v1/rpc/validate_pos_cart_stock", "/rest/v1/rpc/receive_stock_request"]);
  for (const request of observed) { assert.equal(new URL(request.url).origin, "https://data.example.test"); assert.equal(request.headers.get("authorization"), `Bearer ${token}`); assert.equal(request.headers.get("apikey"), null); }
  assert.deepEqual(JSON.parse(await observed[1].clone().text()), { target_organization_id: "organization", target_store_id: "store", target_register_id: "register", target_items: [{ product_id: "product", variant_id: null, quantity: 2 }] });
  assert.deepEqual(JSON.parse(await observed[2].clone().text()), { target_organization_id: "organization", target_stock_request_id: "request", target_note: "Dock", target_operation_id: "operation", target_lines: [{ stock_transfer_line_id: "line", received_quantity: "2", short_quantity: "0", discrepancy_note: "" }] });
});
