import assert from "node:assert/strict";
import test from "node:test";

import { serveFavoriteTileUpdate } from "../dist/src/pos/favorite-tile-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/favorites",
  { method: "POST" },
);

test("favorite-tile service defaults to owned mode", async () => {
  let created = false;
  const response = await serveFavoriteTileUpdate(request(), {
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
  assert.equal((await response.json()).reason, "FAVORITE_TILE_BACKEND_UNAVAILABLE");
});

test("favorite-tile service rejects unknown modes", async () => {
  const response = await serveFavoriteTileUpdate(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "FAVORITE_TILE_BACKEND_UNAVAILABLE");
});

test("favorite-tile proxy mode never constructs owned dependencies", async () => {
  let created = false;
  const response = await serveFavoriteTileUpdate(request(), {
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
  assert.equal((await response.json()).reason, "FAVORITE_TILE_UPSTREAM_UNAVAILABLE");
});
