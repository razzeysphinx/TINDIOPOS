import assert from "node:assert/strict";
import test from "node:test";

import { serveSyncPush } from "../dist/src/pos/sync-push-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/sync/push",
  { method: "POST" },
);

test("sync-push service defaults to owned mode", async () => {
  let created = false;
  const response = await serveSyncPush(request(), {
    mode: undefined,
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("configured-owned-proof"); },
  });
  assert.equal(created, true);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "SYNC_PUSH_BACKEND_UNAVAILABLE");
});

test("sync-push service rejects unknown modes", async () => {
  const response = await serveSyncPush(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "SYNC_PUSH_BACKEND_UNAVAILABLE");
});

test("sync-push proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveSyncPush(request(), {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { created = true; throw new Error("must not run"); },
  });
  assert.equal(created, false);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "SYNC_PUSH_UPSTREAM_UNAVAILABLE");
});
