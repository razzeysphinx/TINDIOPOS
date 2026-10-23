import assert from "node:assert/strict";
import test from "node:test";

import { serveSaleExchange } from "../dist/src/pos/sale-exchange-service.js";

const request = () => new Request("https://backend.test/api/pos/v2/exchanges/link", {
  method: "POST",
  body: "{}",
});

test("sale-exchange service defaults to owned mode", async () => {
  let built = 0;
  const response = await serveSaleExchange(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => {
      built += 1;
      return {
        verifyClaims: async () => ({ data: null, error: null }),
        loadCore: async () => ({ data: null, error: null }),
        link: async () => ({ data: null, error: null }),
      };
    },
  });
  assert.equal(built, 1);
  assert.equal(response.status, 401);
});

test("sale-exchange service rejects unknown modes", async () => {
  const response = await serveSaleExchange(request(), {
    mode: "invalid",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not build"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "SALE_EXCHANGE_BACKEND_UNAVAILABLE",
    requestId: "id",
  });
});

test("sale-exchange proxy mode never constructs owned dependencies", async () => {
  let built = 0;
  const response = await serveSaleExchange(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { built += 1; throw new Error("must not build"); },
  });
  assert.equal(built, 0);
  assert.equal(response.status, 503);
});
