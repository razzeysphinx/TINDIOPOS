import assert from "node:assert/strict";
import test from "node:test";

import { serveRefund } from "../dist/src/pos/refund-service.js";

const request = () => new Request(
  "https://backend.test/api/pos/v2/receipts/40000000-0000-4000-8000-000000000001/refund",
  { method: "POST", body: "{}" },
);

test("refund service defaults to owned mode", async () => {
  let built = 0;
  const response = await serveRefund(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => {
      built += 1;
      return {
        verifyClaims: async () => ({ data: null, error: null }),
        loadCore: async () => ({ data: null, error: null }),
        loadReceiptDetail: async () => ({ data: null, error: null }),
        refund: async () => ({ data: null, error: null }),
      };
    },
  });
  assert.equal(built, 1);
  assert.equal(response.status, 401);
});

test("refund service rejects unknown modes", async () => {
  const response = await serveRefund(request(), {
    mode: "invalid",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not build"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "REFUND_BACKEND_UNAVAILABLE",
    requestId: "id",
  });
});

test("refund proxy mode never constructs owned dependencies", async () => {
  let built = 0;
  const response = await serveRefund(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { built += 1; throw new Error("must not build"); },
  });
  assert.equal(built, 0);
  assert.equal(response.status, 503);
});
