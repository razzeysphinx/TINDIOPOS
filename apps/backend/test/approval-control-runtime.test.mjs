import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedApprovalControlDependencies } from "../dist/src/pos/approval-control-runtime.js";

test("approval-control runtime sends context, RPCs, and scoped status only to Neon", async () => {
  const observed = [];
  const runtime = createOwnedApprovalControlDependencies({
    environment: { SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLISHABLE_KEY: "key", NEON_DATA_API_URL: "https://data.example.test/rest/v1" },
    fetchImpl: async (request) => { observed.push(request); return Response.json(request.method === "GET" ? { status: "PENDING", expires_at: "2026-10-23T01:00:00.000Z" } : []); },
  });
  const token = "header.payload.signature";
  await runtime.loadCore(token, "organization");
  await runtime.rpc(token, "request_manager_approval", { target: "request" });
  await runtime.rpc(token, "approve_manager_approval", { target: "approve" });
  await runtime.loadStatus(token, "organization", "approval");
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), [
    "/rest/v1/rpc/get_pos_bootstrap_core_v2", "/rest/v1/rpc/request_manager_approval",
    "/rest/v1/rpc/approve_manager_approval", "/rest/v1/approval_requests",
  ]);
  for (const request of observed) {
    assert.equal(new URL(request.url).origin, "https://data.example.test");
    assert.equal(request.headers.get("authorization"), `Bearer ${token}`);
    assert.equal(request.headers.get("apikey"), null);
  }
  const statusUrl = new URL(observed[3].url);
  assert.equal(statusUrl.searchParams.get("select"), "status,expires_at");
  assert.equal(statusUrl.searchParams.get("organization_id"), "eq.organization");
  assert.equal(statusUrl.searchParams.get("id"), "eq.approval");
  assert.equal(observed[3].method, "GET");
  assert.equal(observed[3].headers.get("accept-profile"), "public");
});
