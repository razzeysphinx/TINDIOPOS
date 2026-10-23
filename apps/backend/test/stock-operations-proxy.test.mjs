import assert from "node:assert/strict";
import test from "node:test";
import { proxyStockOperation } from "../dist/src/pos/stock-operations-proxy.js";

const REQUEST_ID = "60000000-0000-4000-8000-000000000001";
for (const path of ["/api/pos/v2/cart/validate-stock", `/api/pos/v2/stock-requests/${REQUEST_ID}/receive`]) {
  for (const status of [200, 400, 401, 403, 500, 503]) {
    test(`stock-operation proxy preserves POST ${path} and ${status} contract`, async () => {
      let observed;
      const response = await proxyStockOperation(new Request(`https://backend.test${path}?source=mobile`, { method: "POST", headers: { accept: "application/json", authorization: "Bearer token", "content-type": "application/json", "x-tindio-organization-id": "organization", cookie: "drop=1", "x-tindio-device-secret": "drop" }, body: JSON.stringify({ value: status }) }), {
        upstreamOrigin: "https://web.test", createRequestId: () => "id",
        fetchImpl: async (url, init) => { observed = { url: String(url), init }; return Response.json({ status }, { status, headers: { "cache-control": "private, no-store", "x-tindio-request-id": "upstream", "set-cookie": "drop=1" } }); },
      });
      assert.equal(response.status, status); assert.equal(observed.url, `https://web.test${path}?source=mobile`); assert.equal(observed.init.method, "POST");
      assert.deepEqual(JSON.parse(new TextDecoder().decode(observed.init.body)), { value: status });
      assert.equal(observed.init.headers.get("authorization"), "Bearer token"); assert.equal(observed.init.headers.get("x-tindio-organization-id"), "organization");
      assert.equal(observed.init.headers.get("cookie"), null); assert.equal(observed.init.headers.get("x-tindio-device-secret"), null);
      assert.equal(response.headers.get("x-tindio-request-id"), "upstream"); assert.equal(response.headers.get("set-cookie"), null);
    });
  }
}

test("stock-operation proxy fails closed for unsafe origins, paths, and methods", async () => {
  for (const [method, url, origin] of [
    ["POST", "https://backend.test/api/pos/v2/cart/validate-stock", undefined],
    ["POST", "https://backend.test/api/pos/v2/cart/validate-stock", "https://backend.test"],
    ["GET", "https://backend.test/api/pos/v2/cart/validate-stock", "https://web.test"],
    ["POST", `https://backend.test/api/pos/v2/stock-requests/${REQUEST_ID}`, "https://web.test"],
    ["GET", `https://backend.test/api/pos/v2/stock-requests/${REQUEST_ID}/receive`, "https://web.test"],
    ["POST", `https://backend.test/api/pos/v2/stock-requests/${REQUEST_ID}/receive/nested`, "https://web.test"],
  ]) {
    const response = await proxyStockOperation(new Request(url, { method }), { upstreamOrigin: origin, createRequestId: () => "id" });
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, reason: "STOCK_OPERATIONS_UPSTREAM_UNAVAILABLE", requestId: "id" });
  }
});
