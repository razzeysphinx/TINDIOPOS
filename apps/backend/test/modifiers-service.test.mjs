import assert from "node:assert/strict";
import test from "node:test";

import { servePosModifiers } from "../dist/src/pos/modifiers-service.js";

const request = () => new Request("https://backend.tindio.test/api/pos/v2/modifiers");

test("modifiers service defaults to owned mode", async () => {
  let created = false;
  const response = await servePosModifiers(request(), {
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
  assert.equal((await response.json()).reason, "MODIFIERS_BACKEND_UNAVAILABLE");
});

test("modifiers service rejects unknown modes", async () => {
  const response = await servePosModifiers(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "MODIFIERS_BACKEND_UNAVAILABLE");
});
