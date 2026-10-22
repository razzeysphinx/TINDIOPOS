import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedTransferReceiptDependencies } from "../dist/src/pos/transfer-receipt-runtime.js";

test("transfer-receipt runtime sends context and mutation RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedTransferReceiptDependencies({
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
  await runtime.receive(token, "organization", {
    operationId: "operation",
    stockTransferId: "transfer",
    note: "Dock count",
    lines: [{
      stockTransferLineId: "line",
      receivedQuantity: "2.500",
      shortQuantity: "1",
      discrepancyNote: "Damaged",
    }],
  });

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/receive_stock_transfer",
  ]);
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_stock_transfer_id: "transfer",
    target_note: "Dock count",
    target_operation_id: "operation",
    target_lines: [{
      stock_transfer_line_id: "line",
      received_quantity: "2.500",
      short_quantity: "1",
      discrepancy_note: "Damaged",
    }],
  });
});
