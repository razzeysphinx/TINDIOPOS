import assert from "node:assert/strict";
import test from "node:test";
import { serveStockOperation } from "../dist/src/pos/stock-operations-service.js";

const request = () => new Request("https://backend.test/api/pos/v2/cart/validate-stock", { method: "POST", body: "{}" });
const dependencies = () => ({ verifyClaims: async () => ({ data: null, error: null }), loadCore: async () => ({ data: null, error: null }), validateCart: async () => ({ data: null, error: null }), receiveRequest: async () => ({ data: null, error: null }) });

test("stock-operation service defaults both actions to owned mode", async () => {
  for (const action of ["validate-cart", "receive-request"]) {
    let built = 0; const response = await serveStockOperation(request(), { action, mode: undefined, upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
    assert.equal(built, 1); assert.equal(response.status, 401);
  }
});
test("stock-operation service rejects unknown modes", async () => {
  const response = await serveStockOperation(request(), { action: "validate-cart", mode: "invalid", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: dependencies });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, reason: "STOCK_OPERATIONS_BACKEND_UNAVAILABLE", requestId: "id" });
});
test("stock-operation proxy mode never constructs owned dependencies", async () => {
  let built = 0; const response = await serveStockOperation(request(), { action: "validate-cart", mode: "proxy", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
  assert.equal(built, 0); assert.equal(response.status, 503);
});
