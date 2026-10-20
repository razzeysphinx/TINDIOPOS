import assert from "node:assert/strict";
import test from "node:test";

import { servePosReference } from "../dist/src/pos/reference-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/reference",
  { headers: { authorization: "Bearer header.payload.signature" } },
);

const dependencies = {
  createRequestId: () => "owned-id",
  verifyClaims: async () => ({ data: { claims: {} }, error: null }),
  loadReference: async () => ({
    data: {
      ok: true,
      organizationId: "organization",
      referenceVersion: "v1",
      reference: {
        categories: [],
        paymentMethods: [],
        loyaltyProgram: null,
        discounts: [],
        taxRates: [],
        diningOptions: [],
        ticketTemplates: [],
      },
    },
    error: null,
  }),
};

test("reference service defaults to owned mode", async () => {
  let created = 0;
  const response = await servePosReference(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "service-id",
    createOwnedDependencies: () => {
      created += 1;
      return dependencies;
    },
  });

  assert.equal(created, 1);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 2);
});

test("reference service fails closed for invalid mode and configuration", async () => {
  for (const [mode, createOwnedDependencies] of [
    ["invalid", () => dependencies],
    ["owned", () => { throw new Error("configuration detail"); }],
  ]) {
    const response = await servePosReference(request(), {
      mode,
      upstreamOrigin: undefined,
      createRequestId: () => "service-id",
      createOwnedDependencies,
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "REFERENCE_BACKEND_UNAVAILABLE",
      requestId: "service-id",
    });
  }
});

test("reference proxy mode does not construct owned dependencies", async () => {
  let created = false;
  const response = await servePosReference(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "proxy-id",
    createOwnedDependencies: () => {
      created = true;
      return dependencies;
    },
  });

  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "REFERENCE_UPSTREAM_UNAVAILABLE");
});
