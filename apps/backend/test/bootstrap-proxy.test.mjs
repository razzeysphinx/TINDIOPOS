import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_BOOTSTRAP_PATH,
  proxyPosBootstrap,
} from "../dist/src/pos/bootstrap-proxy.js";

const statuses = [200, 401, 403, 503];

for (const status of statuses) {
  test(`bootstrap proxy preserves the ${status} response contract`, async () => {
    const body = status === 200
      ? {
          ok: true,
          requestId: `upstream-${status}`,
        }
      : {
          ok: false,
          reason: `HTTP_${status}`,
          requestId: `upstream-${status}`,
        };
    let observedUrl;
    let observedInit;

    const response = await proxyPosBootstrap(
      new Request(`https://backend.tindio.test${POS_BOOTSTRAP_PATH}`, {
        headers: {
          accept: "application/json",
          authorization: "Bearer header.payload.signature",
          cookie: "must-not-cross=1",
          "x-not-forwarded": "private",
          "x-tindio-organization-id": "11111111-1111-4111-8111-111111111111",
        },
      }),
      {
        upstreamOrigin: "https://web.tindio.test",
        createRequestId: () => "proxy-fallback-id",
        fetchImpl: async (url, init) => {
          observedUrl = url;
          observedInit = init;

          return Response.json(body, {
            status,
            headers: {
              "cache-control": "private, no-store",
              "retry-after": "5",
              "x-tindio-request-id": `upstream-${status}`,
              "x-upstream-internal": "must-not-cross",
            },
          });
        },
      },
    );

    assert.equal(observedUrl.toString(), `https://web.tindio.test${POS_BOOTSTRAP_PATH}`);
    assert.equal(observedInit.method, "GET");
    assert.equal(observedInit.cache, "no-store");
    assert.equal(observedInit.redirect, "manual");
    assert.equal(observedInit.headers.get("accept"), "application/json");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(
      observedInit.headers.get("x-tindio-organization-id"),
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(observedInit.headers.get("x-not-forwarded"), null);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("content-type"), "application/json");
    assert.equal(response.headers.get("retry-after"), "5");
    assert.equal(response.headers.get("x-tindio-request-id"), `upstream-${status}`);
    assert.equal(response.headers.get("x-upstream-internal"), null);
    assert.equal(await response.text(), JSON.stringify(body));
  });
}

test("bootstrap proxy fails closed for missing, invalid, or looping upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/unexpected-path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyPosBootstrap(
      new Request(`https://backend.tindio.test${POS_BOOTSTRAP_PATH}`),
      {
        upstreamOrigin,
        createRequestId: () => "proxy-config-id",
        fetchImpl: async () => {
          fetchCalled = true;
          return new Response();
        },
      },
    );

    assert.equal(fetchCalled, false);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(response.headers.get("x-tindio-request-id"), "proxy-config-id");
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "BOOTSTRAP_UPSTREAM_UNAVAILABLE",
      requestId: "proxy-config-id",
    });
  }
});
