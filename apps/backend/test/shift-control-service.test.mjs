import assert from "node:assert/strict";
import test from "node:test";
import { serveShiftControl } from "../dist/src/pos/shift-control-service.js";
const request = () => new Request("https://backend.test/api/pos/v2/shifts/open", { method: "POST", body: "{}" });
const dependencies = () => ({ verifyClaims: async () => ({ data: null, error: null }), loadCore: async () => ({ data: null, error: null }), rpc: async () => ({ data: null, error: null }) });
test("shift-control service defaults all four actions to owned mode", async () => {
  for (const action of ["open", "close", "custody", "cashMovement"]) { let built = 0; const response = await serveShiftControl(request(), { action, mode: undefined, upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } }); assert.equal(built, 1); assert.equal(response.status, 401); }
});
test("shift-control service rejects unknown modes", async () => {
  const response = await serveShiftControl(request(), { action: "open", mode: "invalid", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: dependencies });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false, reason: "SHIFT_CONTROL_BACKEND_UNAVAILABLE", requestId: "id" });
});
test("shift-control proxy mode never constructs owned dependencies", async () => {
  let built = 0; const response = await serveShiftControl(request(), { action: "open", mode: "proxy", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
  assert.equal(built, 0); assert.equal(response.status, 503);
});
