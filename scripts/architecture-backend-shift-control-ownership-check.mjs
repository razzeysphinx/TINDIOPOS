import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const routes = ["open.ts", "close.ts", "custody.ts", "cash-movement.ts"];

test("Backend owns exactly the four frozen shift-control POST routes", async () => {
  const sources = await Promise.all(routes.map((route) => read(`apps/backend/api/pos/v2/shifts/${route}`)));
  for (const source of sources) {
    assert.match(source, /export async function POST/); assert.doesNotMatch(source, /export async function (?:GET|PUT|PATCH|DELETE)/);
    assert.match(source, /TINDIO_SHIFT_CONTROL_MODE/); assert.match(source, /TINDIO_WEB_API_ORIGIN/);
  }
  assert.match(await read("apps/backend/.env.example"), /^TINDIO_SHIFT_CONTROL_MODE=owned$/m);
});

test("owned shift control preserves context-first authorization and frozen mappings", async () => {
  const source = await read("apps/backend/src/pos/shift-control-owned.ts");
  for (const value of ["verifyClaims", "loadCore", "IDENTITY_UNMAPPED", "validateOpenShift", "validateMobileCloseShift", "validateShiftCustody", "validateCashMovement", "mapOpenShiftResult", "mapMobileCloseShiftResult", "mapShiftCustodyResult", "mapCashMovementResult"]) assert.ok(source.includes(value), `missing ${value}`);
  assert.ok(source.indexOf("dependencies.verifyClaims(token)") < source.indexOf("dependencies.loadCore(token"));
  assert.ok(source.indexOf("const context = await loadContext(request") < source.indexOf("input = await request.json()"));
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("shift-control runtime keeps Auth at Supabase and mutations at Neon", async () => {
  const source = await read("apps/backend/src/pos/shift-control-runtime.ts");
  assert.match(source, /auth\.auth\.getClaims\(token\)/); assert.match(source, /createNeonDataApiFetch/);
  for (const marker of ["get_pos_bootstrap_core_v2", "x-tindio-device-id", "x-tindio-device-secret", "x-tindio-app-version"]) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(source, /service[_-]?role|DATABASE_URL/i);
});

test("shift-control rollback allowlists all four paths without ambient credentials", async () => {
  const source = await read("apps/backend/src/pos/shift-control-proxy.ts");
  for (const marker of ["POS_SHIFT_OPEN_PATH", "POS_SHIFT_CLOSE_PATH", "POS_SHIFT_CUSTODY_PATH", "POS_SHIFT_CASH_MOVEMENT_PATH", "request.arrayBuffer()", "redirect: \"manual\"", "cache: \"no-store\""]) assert.ok(source.includes(marker), `missing ${marker}`);
  assert.doesNotMatch(source, /headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/);
});

test("D45 retains Web rollback and leaves approvals and stock in Web", async () => {
  const web = await Promise.all(["open/route.ts", "close/route.ts", "custody/route.ts", "cash-movement/route.ts"].map((route) => read(`src/app/api/pos/v2/shifts/${route}`)));
  for (const source of web) assert.match(source, /getPosV2BusinessContext\(request\)/);
  for (const path of ["src/app/api/pos/v2/approvals/request/route.ts", "src/app/api/pos/v2/cart/validate-stock/route.ts"]) assert.match(await read(path), /getPosV2BusinessContext/);
  assert.match(await read("apps/backend/README.md"), /Slice D45 Backend-owned shift control/);
});
