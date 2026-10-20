import assert from "node:assert/strict";
import test from "node:test";

import { servePosBootstrap } from "../dist/src/pos/bootstrap-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/bootstrap",
  { headers: { authorization: "Bearer header.payload.signature" } },
);

const validDependencies = {
  createRequestId: () => "owned-id",
  verifyClaims: async () => ({ data: { claims: { sub: "user" } }, error: null }),
  loadCore: async () => ({
    data: { ok: true, permissions: ["pos.access", "sales.create"] },
    error: null,
  }),
};

test("service defaults to Backend-owned bootstrap", async () => {
  let dependenciesCreated = 0;
  const response = await servePosBootstrap(request(), {
    mode: undefined,
    createRequestId: () => "service-id",
    upstreamOrigin: undefined,
    createOwnedDependencies: () => {
      dependenciesCreated += 1;
      return validDependencies;
    },
  });

  assert.equal(dependenciesCreated, 1);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, 2);
});

test("service fails closed for invalid mode or owned configuration", async () => {
  for (const [mode, createOwnedDependencies] of [
    ["unexpected", () => validDependencies],
    ["owned", () => { throw new Error("configuration detail"); }],
  ]) {
    const response = await servePosBootstrap(request(), {
      mode,
      createRequestId: () => "service-id",
      upstreamOrigin: undefined,
      createOwnedDependencies,
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: "BOOTSTRAP_BACKEND_UNAVAILABLE",
      requestId: "service-id",
    });
  }
});

test("service proxy rollback does not construct owned dependencies", async () => {
  let dependenciesCreated = false;
  const response = await servePosBootstrap(request(), {
    mode: "proxy",
    createRequestId: () => "proxy-id",
    upstreamOrigin: undefined,
    createOwnedDependencies: () => {
      dependenciesCreated = true;
      return validDependencies;
    },
  });

  assert.equal(dependenciesCreated, false);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "BOOTSTRAP_UPSTREAM_UNAVAILABLE",
    requestId: "proxy-id",
  });
});
