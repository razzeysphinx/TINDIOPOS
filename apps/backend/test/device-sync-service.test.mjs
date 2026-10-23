import assert from "node:assert/strict";
import test from "node:test";
import { serveDeviceSync } from "../dist/src/pos/device-sync-service.js";
const request = () => new Request("https://backend.test/api/pos/v2/device", { method: "POST", body: "{}" });
const dependencies = () => ({ verifyClaims: async () => ({ data: null, error: null }), loadCore: async () => ({ data: null, error: null }), rpc: async () => ({ data: null, error: null }) });
test("device-sync service defaults all seven actions to owned mode", async () => {
  for (const action of ["device", "enroll", "baseline", "checkpoint", "pull", "resnapshot", "telemetry"]) {
    let built = 0; const response = await serveDeviceSync(request(), { action, mode: undefined, upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
    assert.equal(built, 1); assert.equal(response.status, 401);
  }
});
test("device-sync service rejects unknown modes", async () => {
  const response = await serveDeviceSync(request(), { action: "device", mode: "invalid", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: dependencies });
  assert.equal(response.status, 503); assert.equal((await response.json()).reason, "DEVICE_SYNC_BACKEND_UNAVAILABLE");
});
test("device-sync proxy mode does not construct owned dependencies", async () => {
  let built = 0; const response = await serveDeviceSync(request(), { action: "device", mode: "proxy", upstreamOrigin: undefined, createRequestId: () => "id", createOwnedDependencies: () => { built += 1; return dependencies(); } });
  assert.equal(built, 0); assert.equal(response.status, 503);
});
