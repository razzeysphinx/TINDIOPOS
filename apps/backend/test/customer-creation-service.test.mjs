import assert from "node:assert/strict";
import test from "node:test";

import { serveCustomerCreation } from "../dist/src/pos/customer-creation-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/customers/create",
  { method: "POST" },
);

test("customer-creation service defaults to owned mode", async () => {
  let created = false;
  const response = await serveCustomerCreation(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CUSTOMER_CREATION_BACKEND_UNAVAILABLE");
});

test("customer-creation service rejects unknown modes", async () => {
  const response = await serveCustomerCreation(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CUSTOMER_CREATION_BACKEND_UNAVAILABLE");
});

test("customer-creation proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveCustomerCreation(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CUSTOMER_CREATION_UPSTREAM_UNAVAILABLE");
});
