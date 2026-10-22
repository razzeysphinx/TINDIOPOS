import assert from "node:assert/strict";
import test from "node:test";

import { proxyOfflineCheckout } from "../dist/src/pos/offline-checkout-proxy.js";

const PATH = "/api/pos/v2/offline-checkout";

for (const status of [200, 400, 401, 403, 409, 500, 503]) {
  test(`offline-checkout proxy preserves body and ${status} contract`, async () => {
    let observedUrl;
    let observedInit;
    const response = await proxyOfflineCheckout(
      new Request(`https://backend.tindio.test${PATH}?source=pos`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
          cookie: "must-not-cross=1",
          "x-tindio-device-secret": "must-not-cross",
          "x-tindio-organization-id": "organization",
          "x-private": "drop-me",
        },
        body: JSON.stringify({ checkout: { id: "checkout" }, device: { secret: "inside-body" } }),
      }),
      {
        upstreamOrigin: "https://web.tindio.test",
        createRequestId: () => "proxy-id",
        fetchImpl: async (url, init) => {
          observedUrl = url;
          observedInit = init;
          return Response.json({ ok: status === 200, message: `HTTP_${status}` }, {
            status,
            headers: {
              "cache-control": "private, no-store",
              "retry-after": "5",
              "x-tindio-request-id": `upstream-${status}`,
              "x-private": "drop-me",
            },
          });
        },
      },
    );
    assert.equal(observedUrl.toString(), `https://web.tindio.test${PATH}?source=pos`);
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(observedInit.headers.get("x-tindio-device-secret"), null);
    assert.deepEqual(JSON.parse(Buffer.from(observedInit.body).toString()), {
      checkout: { id: "checkout" }, device: { secret: "inside-body" },
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-private"), null);
  });
}

test("offline-checkout proxy fails closed for unsafe upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyOfflineCheckout(
      new Request(`https://backend.tindio.test${PATH}`, { method: "POST" }),
      {
        upstreamOrigin,
        createRequestId: () => "proxy-id",
        fetchImpl: async () => { fetchCalled = true; return new Response(); },
      },
    );
    assert.equal(fetchCalled, false);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "OFFLINE_CHECKOUT_UPSTREAM_UNAVAILABLE");
  }
});
