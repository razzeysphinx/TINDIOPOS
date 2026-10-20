import assert from "node:assert/strict";
import test from "node:test";

import { POS_LIVE_PATH, proxyPosLive } from "../dist/src/pos/live-proxy.js";

for (const status of [200, 401, 403, 500, 503]) {
  test(`live proxy preserves query, allowlists, and ${status} contract`, async () => {
    let observedUrl;
    let observedInit;
    const body = status === 200
      ? { ok: true, version: 2, requestId: "upstream", live: {} }
      : { ok: false, reason: `HTTP_${status}`, requestId: "upstream" };
    const query = "?compatibility=proof";
    const response = await proxyPosLive(
      new Request(`https://backend.tindio.test${POS_LIVE_PATH}${query}`, {
        headers: {
          accept: "application/json",
          authorization: "Bearer header.payload.signature",
          cookie: "must-not-cross=1",
          "x-tindio-organization-id": "organization",
          "x-tindio-store-id": "store",
          "x-tindio-register-id": "register",
        },
      }),
      {
        upstreamOrigin: "https://web.tindio.test",
        createRequestId: () => "proxy-id",
        fetchImpl: async (url, init) => {
          observedUrl = url;
          observedInit = init;
          return Response.json(body, {
            status,
            headers: {
              "cache-control": "no-store",
              "retry-after": "5",
              "x-tindio-request-id": `upstream-${status}`,
              "x-private": "drop-me",
            },
          });
        },
      },
    );

    assert.equal(observedUrl.toString(), `https://web.tindio.test${POS_LIVE_PATH}${query}`);
    assert.equal(observedInit.method, "GET");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("x-tindio-store-id"), "store");
    assert.equal(observedInit.headers.get("x-tindio-register-id"), "register");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-tindio-request-id"), `upstream-${status}`);
    assert.equal(response.headers.get("x-private"), null);
    assert.deepEqual(await response.json(), body);
  });
}

test("live proxy fails closed for unsafe upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyPosLive(
      new Request(`https://backend.tindio.test${POS_LIVE_PATH}`),
      {
        upstreamOrigin,
        createRequestId: () => "proxy-id",
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response();
        },
      },
    );
    assert.equal(fetchCalled, false);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "LIVE_UPSTREAM_UNAVAILABLE",
      requestId: "proxy-id",
    });
  }
});
