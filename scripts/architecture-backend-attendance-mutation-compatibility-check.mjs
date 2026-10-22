import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function functionBody(source, schema, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION "${schema}"."${name}"`);
  const end = source.indexOf("\n--\n-- Name:", start + 1);
  assert.ok(start >= 0 && end > start, `missing database function ${schema}.${name}`);
  return source.slice(start, end);
}

test("attendance mutations have a focused platform-neutral shared contract", async () => {
  const [manifestSource, contract] = await Promise.all([
    read("packages/contracts/package.json"),
    read("packages/contracts/src/attendance-mutation.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);
  assert.equal(manifest.exports["./attendance-mutation"].types, "./src/attendance-mutation.ts");
  for (const value of [
    "POS_ATTENDANCE_CLOCK_IN_PATH", "POS_ATTENDANCE_CLOCK_OUT_PATH",
    "POS_ATTENDANCE_CLOCK_IN_RPC", "POS_ATTENDANCE_CLOCK_OUT_RPC",
    "POS_ATTENDANCE_PERMISSION", "clockInSchema", "clockOutSchema",
    "ClockInValues", "ClockOutValues", "AttendanceMutationRow",
    "AttendanceMutationResult",
  ]) assert.match(contract, new RegExp(`\\b${value}\\b`));
  assert.match(contract, /\\d\{6,12\}/);
  assert.doesNotMatch(contract, /next(?:\/|["'])|react-native|@supabase|@neon|node:(?:fs|path)|process\.env/);
});

test("Web attendance retains context-first gates, shared validation, and exact RPC mapping", async () => {
  const [clockInRoute, clockOutRoute, service, schema] = await Promise.all([
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-out/route.ts"),
    read("src/features/time-clock/service.ts"),
    read("src/features/time-clock/time-clock-schema.ts"),
  ]);
  for (const route of [clockInRoute, clockOutRoute]) {
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function (?:GET|PUT|PATCH|DELETE)/);
    assert.ok(route.indexOf("getPosV2BusinessContext(request)") < route.indexOf("context.features.time_clock"));
    assert.ok(route.indexOf("context.features.time_clock") < route.indexOf("readPosApiJson(request)"));
  }
  assert.match(schema, /@tindio\/contracts\/attendance-mutation/);
  assert.match(service, /clockInSchema\.safeParse\(input\)/);
  assert.match(service, /context\.storeIds\.includes\(parsed\.data\.storeId\)/);
  assert.match(service, /clockOutSchema\.safeParse\(input\)/);
  assert.match(service, /supabase\.rpc\(POS_ATTENDANCE_CLOCK_IN_RPC/);
  assert.match(service, /supabase\.rpc\(POS_ATTENDANCE_CLOCK_OUT_RPC/);
  assert.match(service, /result\.result_code === "OPEN_REGISTER_SHIFT"/);
});

test("Backend attendance oracle remains isolated beside the owned mutation routes", async () => {
  const oracle = await read("apps/backend/src/pos/attendance-mutation-compatibility.ts");
  for (const value of [
    "ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT", "validateAttendanceMutationRoute",
    "validateClockInMutation", "validateClockOutMutation", "toClockInRpcArguments",
    "toClockOutRpcArguments", "mapClockInRpcResult", "mapClockOutRpcResult",
    "ATTENDANCE_MUTATION_ROUTE_MESSAGES",
  ]) assert.match(oracle, new RegExp(`\\b${value}\\b`));
  assert.doesNotMatch(oracle, /fetch\(|createPosReadRuntime|createNeonDataApiFetch|@supabase|@neon|process\.env/);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/attendance/clock-in.ts", import.meta.url)), true);
  assert.equal(existsSync(new URL("../apps/backend/api/pos/v2/attendance/clock-out.ts", import.meta.url)), true);
});

test("database authority retains terminal, employee, replay, shift, entry, and audit custody", async () => {
  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const clockIn = functionBody(baseline, "private", "clock_in_employee_with_pin");
  const clockOut = functionBody(baseline, "private", "clock_out_employee_with_pin");
  const publicClockIn = functionBody(baseline, "public", "clock_in_employee_with_pin");
  const publicClockOut = functionBody(baseline, "public", "clock_out_employee_with_pin");
  assert.match(clockIn, /private\.require_attendance_terminal\(target_organization_id, target_store_id\)/);
  assert.match(clockIn, /private\.verify_attendance_employee_pin/);
  assert.match(clockIn, /clock_in_request_id = target_request_id/);
  assert.match(clockIn, /for update of employee/i);
  assert.match(clockIn, /EMPLOYEE_CLOCKED_IN/);
  assert.match(clockOut, /clock_out_request_id = target_request_id/);
  assert.match(clockOut, /private\.require_attendance_terminal\(target_organization_id, selected_entry\.store_id\)/);
  assert.match(clockOut, /status = 'open'/);
  assert.match(clockOut, /OPEN_REGISTER_SHIFT/);
  assert.match(clockOut, /EMPLOYEE_CLOCKED_OUT/);
  assert.match(publicClockIn, /private\.clock_in_employee_with_pin/);
  assert.match(publicClockOut, /private\.clock_out_employee_with_pin/);
  for (const name of ["clock_in_employee_with_pin", "clock_out_employee_with_pin"]) {
    assert.match(baseline, new RegExp(`REVOKE ALL ON FUNCTION "public"\\."${name}"[\\s\\S]+?FROM PUBLIC;`));
    assert.match(baseline, new RegExp(`GRANT ALL ON FUNCTION "public"\\."${name}"[\\s\\S]+?TO "tindio_authenticated";`));
  }
});

test("D36 contract remains intact after D37 ownership while adjacent boundaries stay unchanged", async () => {
  const [mobileApi, clockInRoute, clockOutRoute, backendRead, backendReadme] = await Promise.all([
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-out/route.ts"),
    read("apps/backend/api/pos/v2/attendance/employees.ts"),
    read("apps/backend/README.md"),
  ]);
  assert.match(mobileApi, /request\(POS_ATTENDANCE_CLOCK_IN_PATH/);
  assert.match(mobileApi, /request\(POS_ATTENDANCE_CLOCK_OUT_PATH/);
  assert.match(mobileApi, /type ClockInValues/);
  assert.match(mobileApi, /type ClockOutValues/);
  assert.match(clockInRoute, /clockInEmployee\(\{ context, input: body\.input \}\)/);
  assert.match(clockOutRoute, /clockOutEmployee\(\{ context, input: body\.input \}\)/);
  assert.match(backendRead, /export async function GET/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(backendReadme, /Slice D36 attendance-mutation compatibility oracle/);
  assert.match(backendReadme, /Slice D37 Backend-owned attendance mutations/);
});
