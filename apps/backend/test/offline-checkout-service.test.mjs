import assert from "node:assert/strict";
import test from "node:test";

import { serveOfflineCheckout } from "../dist/src/pos/offline-checkout-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/offline-checkout",
  { method: "POST" },
);

test("offline-checkout service defaults to owned mode", async () => {
  let created = false;
  const response = await serveOfflineCheckout(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OFFLINE_CHECKOUT_BACKEND_UNAVAILABLE");
});

test("offline-checkout service rejects unknown modes", async () => {
  const response = await serveOfflineCheckout(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OFFLINE_CHECKOUT_BACKEND_UNAVAILABLE");
});

test("offline-checkout proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveOfflineCheckout(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "OFFLINE_CHECKOUT_UPSTREAM_UNAVAILABLE");
});
