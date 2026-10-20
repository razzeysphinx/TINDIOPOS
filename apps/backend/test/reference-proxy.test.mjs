import assert from "node:assert/strict";
import test from "node:test";

import {
  POS_REFERENCE_PATH,
  proxyPosReference,
} from "../dist/src/pos/reference-proxy.js";

for (const status of [200, 401, 403, 503]) {
  test(`reference proxy preserves the ${status} contract`, async () => {
    const body = status === 200
      ? { ok: true, version: 2, requestId: `upstream-${status}` }
      : { ok: false, reason: `HTTP_${status}`, requestId: `upstream-${status}` };
    let observedUrl;
    let observedInit;
    const response = await proxyPosReference(
      new Request(`https://backend.tindio.test${POS_REFERENCE_PATH}`, {
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
        createRequestId: () => "proxy-id",
        fetchImpl: async (url, init) => {
          observedUrl = url;
          observedInit = init;
          return Response.json(body, {
            status,
            headers: {
              "cache-control": "private, no-store",
              etag: '"reference-v1"',
              "retry-after": "5",
              "x-tindio-reference-version": "reference-v1",
              "x-tindio-request-id": `upstream-${status}`,
              "x-upstream-private": "must-not-cross",
            },
          });
        },
      },
    );

    assert.equal(observedUrl.toString(), `https://web.tindio.test${POS_REFERENCE_PATH}`);
    assert.equal(observedInit.method, "GET");
    assert.equal(observedInit.cache, "no-store");
    assert.equal(observedInit.redirect, "manual");
    assert.equal(observedInit.headers.get("accept"), "application/json");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(observedInit.headers.get("x-not-forwarded"), null);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("etag"), '"reference-v1"');
    assert.equal(response.headers.get("x-tindio-reference-version"), "reference-v1");
    assert.equal(response.headers.get("x-tindio-request-id"), `upstream-${status}`);
    assert.equal(response.headers.get("x-upstream-private"), null);
    assert.equal(await response.text(), JSON.stringify(body));
  });
}

test("reference proxy fails closed for unsafe upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyPosReference(
      new Request(`https://backend.tindio.test${POS_REFERENCE_PATH}`),
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
      reason: "REFERENCE_UPSTREAM_UNAVAILABLE",
      requestId: "proxy-id",
    });
  }
});
