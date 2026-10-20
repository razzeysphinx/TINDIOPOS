import assert from "node:assert/strict";
import test from "node:test";

import { createOwnedAttendanceEmployeesDependencies } from "../dist/src/pos/attendance-employees-runtime.js";

test("attendance-employees runtime sends its bounded RPC reads only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedAttendanceEmployeesDependencies({
    environment: {
      SUPABASE_URL: "https://auth.example.test",
      SUPABASE_PUBLISHABLE_KEY: "publishable-key",
      NEON_DATA_API_URL: "https://data.example.test/rest/v1",
    },
    createRequestId: () => "id",
    fetchImpl: async (request) => {
      observed.push(request);
      return Response.json([]);
    },
  });

  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.loadAttendanceEmployees(token, "organization", "store");

  assert.equal(observed.length, 2);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("apikey"), null);
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
  }
  assert.equal(
    observed[0].url,
    "https://data.example.test/rest/v1/rpc/get_pos_bootstrap_core_v2",
  );
  assert.equal(
    observed[1].url,
    "https://data.example.test/rest/v1/rpc/get_attendance_employees",
  );
  assert.deepEqual(JSON.parse(await observed[1].text()), {
    target_organization_id: "organization",
    target_store_id: "store",
  });
});
