import assert from "node:assert/strict";
import test from "node:test";

import { proxyCustomerDisplayUpdate } from "../dist/src/pos/customer-display-proxy.js";

const PATH = "/api/pos/v2/customer-display";

for (const status of [204, 400, 401, 403, 500, 503]) {
  test(`customer-display proxy preserves body and ${status} contract`, async () => {
    let observedUrl;
    let observedInit;
    const response = await proxyCustomerDisplayUpdate(
      new Request(`https://backend.tindio.test${PATH}?source=pos`, {
        method: "PUT",
        headers: {
          accept: "application/json",
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
          cookie: "must-not-cross=1",
          "x-tindio-organization-id": "organization",
          "x-private": "drop-me",
        },
        body: JSON.stringify({ sessionId: "session", state: { status: "idle" } }),
      }),
      {
        upstreamOrigin: "https://web.tindio.test",
        createRequestId: () => "proxy-id",
        fetchImpl: async (url, init) => {
          observedUrl = url;
          observedInit = init;
          return status === 204
            ? new Response(null, { status, headers: { "cache-control": "no-store" } })
            : Response.json({ error: `HTTP_${status}` }, {
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
    assert.equal(observedInit.method, "PUT");
    assert.equal(observedInit.headers.get("authorization"), "Bearer header.payload.signature");
    assert.equal(observedInit.headers.get("content-type"), "application/json");
    assert.equal(observedInit.headers.get("cookie"), null);
    assert.equal(observedInit.headers.get("x-private"), null);
    assert.deepEqual(JSON.parse(Buffer.from(observedInit.body).toString()), {
      sessionId: "session",
      state: { status: "idle" },
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-private"), null);
    if (status === 204) assert.equal(await response.text(), "");
    else assert.deepEqual(await response.json(), { error: `HTTP_${status}` });
  });
}

test("customer-display proxy fails closed for unsafe upstream origins", async () => {
  for (const upstreamOrigin of [
    undefined,
    "not-a-url",
    "file:///tmp/tindio",
    "https://user:password@web.tindio.test",
    "https://web.tindio.test/path",
    "https://backend.tindio.test",
  ]) {
    let fetchCalled = false;
    const response = await proxyCustomerDisplayUpdate(
      new Request(`https://backend.tindio.test${PATH}`, { method: "PUT" }),
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
    assert.equal((await response.json()).reason, "CUSTOMER_DISPLAY_UPSTREAM_UNAVAILABLE");
  }
});
