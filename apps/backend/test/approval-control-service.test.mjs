import assert from "node:assert/strict";
import test from "node:test";
import { serveApprovalControl } from "../dist/src/pos/approval-control-service.js";

const request = () => new Request("https://backend.test/api/pos/v2/approvals/request", { method: "POST", body: "{}" });
const dependencies = () => ({ verifyClaims: async () => ({ data: null, error: null }), loadCore: async () => ({ data: null, error: null }), rpc: async () => ({ data: null, error: null }), loadStatus: async () => ({ data: null, error: null }) });

test("approval-control service defaults all three actions to owned mode", async () => {
  for (const action of ["request", "approve", "status"]) {
    let built = 0;
    const response = await serveApprovalControl(request(), { action, mode: undefined, upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
    assert.equal(built, 1); assert.equal(response.status, 401);
  }
});
test("approval-control service rejects unknown modes", async () => {
  const response = await serveApprovalControl(request(), { action: "request", mode: "invalid", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: dependencies });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, reason: "APPROVAL_CONTROL_BACKEND_UNAVAILABLE", requestId: "id" });
});
test("approval-control proxy mode never constructs owned dependencies", async () => {
  let built = 0;
  const response = await serveApprovalControl(request(), { action: "request", mode: "proxy", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
  assert.equal(built, 0); assert.equal(response.status, 503);
});
