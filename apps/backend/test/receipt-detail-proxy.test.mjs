import assert from "node:assert/strict";
import test from "node:test";

import { proxyPosReceiptDetail } from "../dist/src/pos/receipt-detail-proxy.js";

const PATH = "/api/pos/v2/receipts/55555555-5555-4555-8555-555555555555";

for (const status of [200, 400, 401, 403, 404, 500, 503]) {
  test(`receipt-detail proxy preserves dynamic path, query, and ${status} contract`, async () => {
    let observedUrl;
    let observedInit;
    const body = status === 200
      ? { receipt: { id: "receipt" } }
      : { ok: false, message: `HTTP_${status}` };
    const response = await proxyPosReceiptDetail(
      new Request(`https://backend.tindio.test${PATH}?print=1`, {
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

    assert.equal(observedUrl.toString(), `https://web.tindio.test${PATH}?print=1`);
    assert.equal(observedInit.method, "GET");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-tindio-request-id"), `upstream-${status}`);
    assert.equal(response.headers.get("x-private"), null);
    assert.deepEqual(await response.json(), body);
  });
}

test("receipt-detail proxy fails closed for unsafe origins and nested mutation paths", async () => {
  for (const [upstreamOrigin, path] of [
    [undefined, PATH],
    ["not-a-url", PATH],
    ["file:///tmp/tindio", PATH],
    ["https://user:password@web.tindio.test", PATH],
    ["https://web.tindio.test/path", PATH],
    ["https://backend.tindio.test", PATH],
    ["https://web.tindio.test", `${PATH}/delivery`],
    ["https://web.tindio.test", `${PATH}/refund`],
  ]) {
    let fetchCalled = false;
    const response = await proxyPosReceiptDetail(
      new Request(`https://backend.tindio.test${path}`),
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
    assert.equal((await response.json()).reason, "RECEIPT_DETAIL_UPSTREAM_UNAVAILABLE");
  }
});
