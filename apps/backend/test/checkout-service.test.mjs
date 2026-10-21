import assert from "node:assert/strict";
import test from "node:test";

import { serveCheckout } from "../dist/src/pos/checkout-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/checkout",
  { method: "POST" },
);

test("checkout service defaults to owned mode", async () => {
  let created = false;
  const response = await serveCheckout(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CHECKOUT_BACKEND_UNAVAILABLE");
});

test("checkout service rejects unknown modes", async () => {
  const response = await serveCheckout(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CHECKOUT_BACKEND_UNAVAILABLE");
});

test("checkout proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveCheckout(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CHECKOUT_UPSTREAM_UNAVAILABLE");
});
