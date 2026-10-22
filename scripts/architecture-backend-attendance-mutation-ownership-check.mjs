import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns only the two attendance POST mutations", async () => {
  const [clockIn, clockOut, service, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/attendance/clock-in.ts"),
    read("apps/backend/api/pos/v2/attendance/clock-out.ts"),
    read("apps/backend/src/pos/attendance-mutation-service.ts"),
    read("apps/backend/.env.example"),
  ]);
  for (const route of [clockIn, clockOut]) {
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
    assert.match(route, /TINDIO_ATTENDANCE_MUTATION_MODE/);
  }
  assert.match(clockIn, /serveAttendanceMutation\(request, "clock-in"/);
  assert.match(clockOut, /serveAttendanceMutation\(request, "clock-out"/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(service, /mode === ["']proxy["']/);
  assert.match(environment, /^TINDIO_ATTENDANCE_MUTATION_MODE=owned$/m);
});

test("owned attendance preserves context-first gates, custody, validation, and response mapping", async () => {
  const owned = await read("apps/backend/src/pos/attendance-mutation-owned.ts");
  for (const value of [
    "POS_ATTENDANCE_REQUEST_INVALID_MESSAGE", "verifyClaims", "loadCore",
    "IDENTITY_UNMAPPED", "ORGANIZATION_INACTIVE", "validateAttendanceMutationRoute",
    "validateClockInMutation", "validateClockOutMutation", "clockIn", "clockOut",
    "mapClockInRpcResult", "mapClockOutRpcResult",
    '"cache-control": "private, no-store"',
  ]) assert.ok(owned.includes(value), `missing owned attendance behavior ${value}`);
  assert.ok(owned.indexOf("bearerFromRequest(request)") < owned.indexOf("loadCore(token"));
  assert.ok(owned.indexOf("loadCore(token") < owned.lastIndexOf("validateAttendanceMutationRoute"));
  assert.ok(owned.lastIndexOf("validateAttendanceMutationRoute") < owned.indexOf("request.json()"));
  assert.ok(owned.indexOf("request.json()") < owned.lastIndexOf("validateClockInMutation"));
  assert.ok(owned.lastIndexOf("validateClockInMutation") < owned.indexOf("dependencies.clockIn("));
  assert.ok(owned.lastIndexOf("validateClockOutMutation") < owned.indexOf("dependencies.clockOut("));
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("attendance runtime verifies Supabase claims and sends all database RPCs only to Neon", async () => {
  const [runtime, adapter] = await Promise.all([
    read("apps/backend/src/pos/attendance-mutation-runtime.ts"),
    read("apps/backend/src/database/neon-data-api-fetch.ts"),
  ]);
  assert.match(runtime, /authClient\.auth\.getClaims\(token\)/);
  assert.match(runtime, /createNeonDataApiFetch/);
  for (const value of [
    "get_pos_bootstrap_core_v2", "POS_ATTENDANCE_CLOCK_IN_RPC",
    "POS_ATTENDANCE_CLOCK_OUT_RPC", "toClockInRpcArguments", "toClockOutRpcArguments",
  ]) assert.ok(runtime.includes(value), `missing attendance runtime operation ${value}`);
  assert.match(adapter, /rewritten\.headers\.delete\(["']apikey["']\)/);
  assert.doesNotMatch(runtime, /createPosReadRuntime|service[_-]?role|DATABASE_URL/i);
});

test("attendance rollback preserves both exact paths and bodies while rejecting ambient credentials", async () => {
  const proxy = await read("apps/backend/src/pos/attendance-mutation-proxy.ts");
  assert.match(proxy, /ATTENDANCE_MUTATION_PATH_PATTERN/);
  assert.match(proxy, /clock-in\|clock-out/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /method:\s*["']POST["']/);
  assert.match(proxy, /body:\s*await request\.arrayBuffer\(\)/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);
  for (const header of [
    "accept", "authorization", "content-type", "x-tindio-organization-id",
    "cache-control", "retry-after", "x-tindio-request-id",
  ]) assert.match(proxy, new RegExp(`["']${header}["']`));
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']|["']x-tindio-device-secret["']/);
});

test("D37 moves attendance mutations only while clients, Web rollback, and shift ownership stay unchanged", async () => {
  const [webClockIn, webClockOut, mobileApi, openShift, closeShift, employees, readme] = await Promise.all([
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-out/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/app/api/pos/v2/shifts/open/route.ts"),
    read("src/app/api/pos/v2/shifts/close/route.ts"),
    read("apps/backend/api/pos/v2/attendance/employees.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(webClockIn, /clockInEmployee\(\{ context, input: body\.input \}\)/);
  assert.match(webClockOut, /clockOutEmployee\(\{ context, input: body\.input \}\)/);
  assert.match(mobileApi, /request\(POS_ATTENDANCE_CLOCK_IN_PATH/);
  assert.match(mobileApi, /request\(POS_ATTENDANCE_CLOCK_OUT_PATH/);
  for (const route of [openShift, closeShift]) assert.match(route, /export async function POST/);
  assert.match(employees, /export async function GET/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /Slice D37 Backend-owned attendance mutations/);
});
