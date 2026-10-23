import assert from "node:assert/strict";
import test from "node:test";
import { createOwnedShiftControlDependencies } from "../dist/src/pos/shift-control-runtime.js";

test("shift-control runtime sends context and mutations only to Neon with scoped device custody", async () => {
  const observed = [];
  const runtime = createOwnedShiftControlDependencies({ environment: { SUPABASE_URL: "https://auth.example.test", SUPABASE_PUBLISHABLE_KEY: "key", NEON_DATA_API_URL: "https://data.example.test/rest/v1" }, fetchImpl: async (request) => { observed.push(request); return Response.json([]); } });
  const token = "header.payload.signature"; const device = { deviceId: "device", secret: "secret", appVersion: "1" };
  await runtime.loadCore(token, "organization");
  await runtime.rpc(token, "open_register_shift", { target: "open" }, device);
  await runtime.rpc(token, "close_register_shift_mobile", { target: "close" }, device);
  await runtime.rpc(token, "acquire_pos_shift_custody", { target: "custody" }, device);
  await runtime.rpc(token, "record_cash_movement", { target: "cash" });
  assert.deepEqual(observed.map((request) => new URL(request.url).pathname), ["/rest/v1/rpc/get_pos_bootstrap_core_v2", "/rest/v1/rpc/open_register_shift", "/rest/v1/rpc/close_register_shift_mobile", "/rest/v1/rpc/acquire_pos_shift_custody", "/rest/v1/rpc/record_cash_movement"]);
  for (const request of observed) { assert.equal(new URL(request.url).origin, "https://data.example.test"); assert.equal(request.headers.get("authorization"), `Bearer ${token}`); assert.equal(request.headers.get("apikey"), null); }
  assert.equal(observed[0].headers.get("x-tindio-device-id"), null); assert.equal(observed[1].headers.get("x-tindio-device-id"), "device"); assert.equal(observed[1].headers.get("x-tindio-device-secret"), "secret"); assert.equal(observed[4].headers.get("x-tindio-device-id"), null);
});
