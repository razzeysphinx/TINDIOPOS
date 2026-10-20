import assert from "node:assert/strict";
import test from "node:test";

import { POS_CATALOG_PATH, proxyPosCatalog } from "../dist/src/pos/catalog-proxy.js";

for (const status of [200, 401, 403, 503]) {
  test(`catalogue proxy preserves query and ${status} contract`, async () => {
    let observedUrl;
    let observedInit;
    const body = status === 200 ? { ok: true } : { ok: false, reason: `HTTP_${status}` };
    const response = await proxyPosCatalog(
      new Request(`https://backend.tindio.test${POS_CATALOG_PATH}?store=store&mode=favorites&query=iced+tea`, {
        headers: {
          accept: "application/json",
          authorization: "Bearer header.payload.signature",
          cookie: "must-not-cross=1",
          "x-tindio-organization-id": "organization",
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
              "retry-after": "5",
              "x-tindio-request-id": `upstream-${status}`,
              "x-private": "drop-me",
            },
          });
        },
      },
    );

    assert.equal(observedUrl.toString(), `https://web.tindio.test${POS_CATALOG_PATH}?store=store&mode=favorites&query=iced+tea`);
    assert.equal(observedInit.method, "GET");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-tindio-request-id"), `upstream-${status}`);
    assert.equal(response.headers.get("x-private"), null);
    assert.deepEqual(await response.json(), body);
  });
}

test("catalogue proxy fails closed for unsafe upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyPosCatalog(
      new Request(`https://backend.tindio.test${POS_CATALOG_PATH}?store=store`),
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
    assert.equal((await response.json()).reason, "CATALOG_UPSTREAM_UNAVAILABLE");
  }
});
