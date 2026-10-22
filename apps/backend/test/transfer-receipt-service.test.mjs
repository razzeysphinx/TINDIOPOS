import assert from "node:assert/strict";
import test from "node:test";

import { serveTransferReceipt } from "../dist/src/pos/transfer-receipt-service.js";

const request = () => new Request(
  "https://backend.test/api/pos/v2/transfers/40000000-0000-4000-8000-000000000001/receive",
  { method: "POST", body: "{}" },
);

test("transfer-receipt service defaults to owned mode", async () => {
  let built = 0;
  const response = await serveTransferReceipt(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => {
      built += 1;
      return {
        verifyClaims: async () => ({ data: null, error: null }),
        loadCore: async () => ({ data: null, error: null }),
        receive: async () => ({ data: null, error: null }),
      };
    },
  });
  assert.equal(built, 1);
  assert.equal(response.status, 401);
});

test("transfer-receipt service rejects unknown modes", async () => {
  const response = await serveTransferReceipt(request(), {
    mode: "invalid",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not build"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "TRANSFER_RECEIPT_BACKEND_UNAVAILABLE",
    requestId: "id",
  });
});

test("transfer-receipt proxy mode never constructs owned dependencies", async () => {
  let built = 0;
  const response = await serveTransferReceipt(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { built += 1; throw new Error("must not build"); },
  });
  assert.equal(built, 0);
  assert.equal(response.status, 503);
});
