import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedAttendanceMutationDependencies } from "../dist/src/pos/attendance-mutation-runtime.js";

test("attendance runtime sends context and both mutation RPCs only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedAttendanceMutationDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json({ ok: true });
    },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.clockIn(token, "organization", {
    storeId: "store", employeeId: "employee", pin: "123456", requestId: "request-in",
  });
  await runtime.clockOut(token, "organization", {
    employeeId: "employee", pin: "654321", requestId: "request-out",
  });

  assert.equal(observed.length, 3);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2",
    "/rest/v1/rpc/clock_in_employee_with_pin",
    "/rest/v1/rpc/clock_out_employee_with_pin",
  ]);
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_employee_id: "employee",
    target_organization_id: "organization",
    target_pin: "123456",
    target_request_id: "request-in",
    target_store_id: "store",
  });
  assert.deepEqual(JSON.parse(await observed[2].text()), {
    target_employee_id: "employee",
    target_organization_id: "organization",
    target_pin: "654321",
    target_request_id: "request-out",
  });
});
