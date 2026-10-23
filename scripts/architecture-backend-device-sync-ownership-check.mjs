import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const routes = ["device.ts", "device/enroll.ts", "sync/baseline.ts", "sync/checkpoint.ts", "sync/pull.ts", "sync/resnapshot.ts", "sync/telemetry.ts"];

test("Backend owns exactly the seven frozen device and sync-control POST routes", async () => {
  const sources = await Promise.all(routes.map((route) => read(`apps/backend/api/pos/v2/${route}`)));
  for (const source of sources) {
    assert.match(source, /export async function POST/); assert.doesNotMatch(source, /export async function (?:GET|PUT|PATCH|DELETE)/);
    assert.match(source, /TINDIO_DEVICE_SYNC_MODE/); assert.match(source, /TINDIO_WEB_API_ORIGIN/);
  }
  assert.match(await read("apps/backend/.env.example"), /^TINDIO_DEVICE_SYNC_MODE=owned$/m);
});

test("owned device-sync preserves context-first authorization and frozen mappings", async () => {
  const source = await read("apps/backend/src/pos/device-sync-owned.ts");
  for (const value of ["verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "validateDeviceRequest", "validateDeviceEnrollment", "checkedDevice", "mapSyncCheckpoint", "mapSyncRetention", "createSyncCursorExpiredResponse", "validateSyncResnapshot", "toSyncTelemetryRpcArguments"]) assert.ok(source.includes(value), `missing ${value}`);
  assert.ok(source.indexOf("dependencies.verifyClaims(token)") < source.indexOf("dependencies.loadCore(token"));
  assert.ok(source.indexOf("const resolved = await context(request") < source.indexOf("const parsedBody = await body(request)"));
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("device-sync runtime keeps Auth at Supabase and database authority at Neon", async () => {
  const source = await read("apps/backend/src/pos/device-sync-runtime.ts");
  assert.match(source, /auth\.auth\.getClaims\(token\)/); assert.match(source, /createNeonDataApiFetch/);
  assert.match(source, /get_pos_bootstrap_core_v2/); assert.match(source, /x-tindio-device-id/); assert.match(source, /x-tindio-device-secret/);
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("device-sync rollback allowlists all seven paths without ambient credentials", async () => {
  const source = await read("apps/backend/src/pos/device-sync-proxy.ts");
  for (const marker of ["POS_DEVICE_VALIDATION_PATH", "POS_DEVICE_ENROLLMENT_PATH", "POS_SYNC_BASELINE_PATH", "POS_SYNC_CHECKPOINT_PATH", "POS_SYNC_PULL_PATH", "POS_SYNC_RESNAPSHOT_PATH", "POS_SYNC_TELEMETRY_PATH", "request.arrayBuffer()", "redirect: \"manual\"", "cache: \"no-store\""]) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(source, /headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/);
});

test("D43 retains every Web rollback route and leaves adjacent custody routes in Web", async () => {
  const web = await Promise.all([
    "device/route.ts", "device/enroll/route.ts", "sync/baseline/route.ts", "sync/checkpoint/route.ts", "sync/pull/route.ts", "sync/resnapshot/route.ts", "sync/telemetry/route.ts",
  ].map((route) => read(`src/app/api/pos/v2/${route}`)));
  for (const source of web) assert.match(source, /getPosV2BusinessContext\(request\)/);
  for (const path of ["src/app/api/pos/v2/shifts/open/route.ts", "src/app/api/pos/v2/approvals/request/route.ts", "src/app/api/pos/v2/cart/validate-stock/route.ts"]) assert.match(await read(path), /getPosV2BusinessContext/);
  assert.match(await read("apps/backend/README.md"), /Slice D43 Backend-owned device and sync control/);
});
