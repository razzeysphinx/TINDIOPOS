import assert from "node:assert/strict";
import test from "node:test";

import { servePosLive } from "../dist/src/pos/live-service.js";

const request = () => new Request("https://backend.tindio.test/api/pos/v2/live");

test("live service defaults to owned mode", async () => {
  let created = false;
  const response = await servePosLive(request(), {
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
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "LIVE_BACKEND_UNAVAILABLE",
    requestId: "id",
  });
});

test("live service rejects unknown modes", async () => {
  const response = await servePosLive(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "LIVE_BACKEND_UNAVAILABLE");
});
