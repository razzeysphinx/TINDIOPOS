import assert from "node:assert/strict";
import test from "node:test";

import { serveCustomerDisplayUpdate } from "../dist/src/pos/customer-display-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/customer-display",
  { method: "PUT" },
);

test("customer-display service defaults to owned mode", async () => {
  let created = false;
  const response = await serveCustomerDisplayUpdate(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => {
      created = true;
      throw new Error("configured-owned-proof");
    },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CUSTOMER_DISPLAY_BACKEND_UNAVAILABLE");
});

test("customer-display service rejects unknown modes", async () => {
  const response = await serveCustomerDisplayUpdate(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CUSTOMER_DISPLAY_BACKEND_UNAVAILABLE");
});

test("customer-display proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveCustomerDisplayUpdate(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => {
      created = true;
      throw new Error("must not run");
    },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CUSTOMER_DISPLAY_UPSTREAM_UNAVAILABLE");
});
