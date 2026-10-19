import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "../dist/api/health.js";

test("backend health returns a stable no-store response", async () => {
  const response = GET();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    service: "tindio-backend",
    status: "ok",
    version: 1,
  });
});
