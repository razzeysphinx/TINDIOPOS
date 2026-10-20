import assert from "node:assert/strict";
import test from "node:test";

import { servePosAttendanceEmployees } from "../dist/src/pos/attendance-employees-service.js";

const request = () => new Request(
  "https://backend.tindio.test/api/pos/v2/attendance/employees?store=22222222-2222-4222-8222-222222222222",
);

test("attendance-employees service defaults to owned mode", async () => {
  let created = false;
  const response = await servePosAttendanceEmployees(request(), {
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
  assert.equal((await response.json()).reason, "ATTENDANCE_EMPLOYEES_BACKEND_UNAVAILABLE");
});

test("attendance-employees service rejects unknown modes", async () => {
  const response = await servePosAttendanceEmployees(request(), {
    mode: "unknown",
    upstreamOrigin: undefined,
    createRequestId: () => "id",
    createOwnedDependencies: () => { throw new Error("must not run"); },
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, "ATTENDANCE_EMPLOYEES_BACKEND_UNAVAILABLE");
});
