import assert from "node:assert/strict";
import test from "node:test";

import { servePosCatalog } from "../dist/src/pos/catalog-service.js";

const request = () => new Request("https://backend.tindio.test/api/pos/v2/catalog");

test("catalogue service defaults to owned mode", async () => {
  let created = false;
  const response = await servePosCatalog(request(), {
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
  assert.equal((await response.json()).reason, "CATALOG_BACKEND_UNAVAILABLE");
});

test("catalogue service rejects unknown modes", async () => {
  const response = await servePosCatalog(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "CATALOG_BACKEND_UNAVAILABLE");
});
