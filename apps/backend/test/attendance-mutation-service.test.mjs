import assert from "node:assert/strict";
import test from "node:test";

import { serveAttendanceMutation } from "../dist/src/pos/attendance-mutation-service.js";

const request = (action = "clock-in") => new Request(
  `https://backend.test/api/pos/v2/attendance/${action}`,
  { method: "POST", body: "{}" },
);

const dependencies = () => ({
  verifyClaims: async () => ({ data: null, error: null }),
  loadCore: async () => ({ data: null, error: null }),
  clockIn: async () => ({ data: null, error: null }),
  clockOut: async () => ({ data: null, error: null }),
});

test("attendance mutation service defaults both actions to owned mode", async () => {
  for (const action of ["clock-in", "clock-out"]) {
    let built = 0;
    const response = await serveAttendanceMutation(request(action), action, {
      mode: undefined,
      upstreamOrigin: undefined,
      createRequestId: () => "id",
      createOwnedDependencies: () => { built += 1; return dependencies(); },
    });
    assert.equal(built, 1);
    assert.equal(response.status, 401);
  }
});

test("attendance mutation service rejects unknown modes", async () => {
  const response = await serveAttendanceMutation(request(), "clock-in", {
    mode: "invalid",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not build"); },
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    reason: "ATTENDANCE_MUTATION_BACKEND_UNAVAILABLE",
    requestId: "id",
  });
});

test("attendance mutation proxy mode never constructs owned dependencies", async () => {
  let built = 0;
  const response = await serveAttendanceMutation(request(), "clock-in", {
    mode: "proxy",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { built += 1; throw new Error("must not build"); },
  });
  assert.equal(built, 0);
  assert.equal(response.status, 503);
});
