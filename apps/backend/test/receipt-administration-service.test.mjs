import assert from "node:assert/strict";
import test from "node:test";

import { serveReceiptAdministration } from "../dist/src/pos/receipt-administration-service.js";

const request = () => new Request("https://backend.test/api/pos/v2/receipt-settings", {
  method: "POST",
  body: "{}",
});
const dependencies = () => ({
  verifyClaims: async () => ({ data: null, error: null }),
  loadCore: async () => ({ data: null, error: null }),
  updateSettings: async () => ({ data: null, error: null }),
  queueDelivery: async () => ({ data: null, error: null }),
});

test("receipt-administration service defaults both actions to owned mode", async () => {
  for (const action of ["settings", "delivery"]) {
    let built = 0;
    const response = await serveReceiptAdministration(request(), {
      action,
      mode: undefined,
      upstreamOrigin: undefined,
      createRequestId: () => "id",
      createOwnedDependencies: () => { built += 1; return dependencies(); },
    });
    assert.equal(built, 1);
    assert.equal(response.status, 401);
  }
});

test("receipt-administration service rejects unknown modes", async () => {
  const response = await serveReceiptAdministration(request(), {
    action: "settings",
    mode: "invalid",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not build"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "RECEIPT_ADMINISTRATION_BACKEND_UNAVAILABLE",
    requestId: "id",
  });
});

test("receipt-administration proxy mode never constructs owned dependencies", async () => {
  let built = 0;
  const response = await serveReceiptAdministration(request(), {
    action: "settings",
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { built += 1; throw new Error("must not build"); },
  });
  assert.equal(built, 0);
  assert.equal(response.status, 503);
});
