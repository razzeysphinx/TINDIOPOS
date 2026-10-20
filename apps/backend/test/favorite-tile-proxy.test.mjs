import assert from "node:assert/strict";
import test from "node:test";

import { proxyFavoriteTileUpdate } from "../dist/src/pos/favorite-tile-proxy.js";

const PATH = "/api/pos/v2/favorites";

for (const status of [200, 400, 401, 403, 500, 503]) {
  test(`favorite-tile proxy preserves body and ${status} contract`, async () => {
    let observedUrl;
    let observedInit;
    const response = await proxyFavoriteTileUpdate(
      new Request(`https://backend.tindio.test${PATH}?source=pos`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
          cookie: "must-not-cross=1",
          "x-tindio-organization-id": "organization",
          "x-private": "drop-me",
        },
        body: JSON.stringify({ storeId: "store", productId: "product" }),
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
    assert.equal(observedInit.method, "POST");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("content-type"), "application/json");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(observedInit.headers.get("x-private"), null);
    assert.deepEqual(JSON.parse(Buffer.from(observedInit.body).toString()), {
      storeId: "store",
      productId: "product",
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-private"), null);
    assert.deepEqual(await response.json(), {
      ok: status === 200,
      message: `HTTP_${status}`,
    });
  });
}

test("favorite-tile proxy fails closed for unsafe upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyFavoriteTileUpdate(
      new Request(`https://backend.tindio.test${PATH}`, { method: "POST" }),
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
    assert.equal((await response.json()).reason, "FAVORITE_TILE_UPSTREAM_UNAVAILABLE");
  }
});
