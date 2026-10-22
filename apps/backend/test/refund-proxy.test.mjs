import assert from "node:assert/strict";
import test from "node:test";

import { proxyRefund } from "../dist/src/pos/refund-proxy.js";

const PATH = "/api/pos/v2/receipts/40000000-0000-4000-8000-000000000001/refund";

for (const status of [200, 400, 401, 403, 404, 500, 503]) {
  test(`refund proxy preserves dynamic path, body, and ${status} contract`, async () => {
    let observed;
    const response = await proxyRefund(new Request(`https://backend.test${PATH}?source=mobile`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: "Bearer token",
        "content-type": "application/json",
        cookie: "secret=drop",
        "x-tindio-device-secret": "drop",
        "x-tindio-organization-id": "organization",
      },
      body: JSON.stringify({ value: status }),
    }), {
      upstreamOrigin: "https://web.test",
      createRequestId: () => "request-id",
      fetchImpl: async (url, init) => {
        observed = { url: String(url), init };
        return new Response(JSON.stringify({ status }), {
          status,
          headers: {
            "cache-control": "private, no-store",
            "content-type": "application/json",
            "x-tindio-request-id": "upstream-id",
            "set-cookie": "drop=1",
          },
        });
      },
    });
    assert.equal(response.status, status);
    assert.equal(observed.url, `https://web.test${PATH}?source=mobile`);
    assert.equal(observed.init.method, "POST");
    assert.deepEqual(JSON.parse(new TextDecoder().decode(observed.init.body)), { value: status });
    assert.equal(observed.init.headers.get("authorization"), "Bearer token");
    assert.equal(observed.init.headers.get("cookie"), null);
    assert.equal(observed.init.headers.get("x-tindio-device-secret"), null);
    assert.equal(response.headers.get("x-tindio-request-id"), "upstream-id");
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

test("refund proxy fails closed for unsafe origins and non-refund paths", async () => {
  for (const [url, upstreamOrigin] of [
    [`https://backend.test${PATH}`, undefined],
    [`https://backend.test${PATH}`, "https://backend.test"],
    ["https://backend.test/api/pos/v2/receipts/id", "https://web.test"],
    [`https://backend.test${PATH}/nested`, "https://web.test"],
  ]) {
    const response = await proxyRefund(new Request(url, { method: "POST" }), {
      upstreamOrigin,
      createRequestId: () => "request-id",
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "REFUND_UPSTREAM_UNAVAILABLE",
      requestId: "request-id",
    });
  }
});
