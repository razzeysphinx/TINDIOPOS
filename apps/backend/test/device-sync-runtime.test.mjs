import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedDeviceSyncDependencies } from "../dist/src/pos/device-sync-runtime.js";
test("device-sync runtime routes database RPCs to Neon and forwards device custody headers", async () => {
  const observed = [];
  const runtime = createOwnedDeviceSyncDependencies({ environment: { SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLISHABLE_KEY: "key", NEON_DATA_API_URL: "https://data.example.test/rest/v1" }, fetchImpl: async (request) => { observed.push(request); return Response.json([]); } });
  const token = "header.payload.signature"; const device = { deviceId: "device", secret: "secret", appVersion: "1" };
  await runtime.loadCore(token, "organization"); await runtime.rpc(token, "validate_pos_device", { target: true }, device);
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), ["/rest/v1/rpc/get_pos_bootstrap_core_v2", "/rest/v1/rpc/validate_pos_device"]);
  for (const request of observed) { assert.equal(new URL(request.url).origin, "https://data.example.test"); assert.equal(request.headers.get("authorization"), `Bearer ${token}`); assert.equal(request.headers.get("apikey"), null); }
  assert.equal(observed[0].headers.get("x-tindio-device-id"), null); assert.equal(observed[1].headers.get("x-tindio-device-id"), "device"); assert.equal(observed[1].headers.get("x-tindio-device-secret"), "secret");
});
