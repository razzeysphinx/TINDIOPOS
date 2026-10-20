import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Backend owns the bounded POS attendance-employee read", async () => {
  const [route, service, owned, runtime, sharedRuntime, environment] = await Promise.all([
    read("apps/backend/api/pos/v2/attendance/employees.ts"),
    read("apps/backend/src/pos/attendance-employees-service.ts"),
    read("apps/backend/src/pos/attendance-employees-owned.ts"),
    read("apps/backend/src/pos/attendance-employees-runtime.ts"),
    read("apps/backend/src/pos/pos-read-runtime.ts"),
    read("apps/backend/.env.example"),
  ]);

  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /POST|PUT|PATCH|DELETE/);
  assert.match(route, /TINDIO_ATTENDANCE_EMPLOYEES_READ_MODE/);
  assert.match(service, /options\.mode \?\? ["']owned["']/);
  assert.match(owned, /handleOwnedPosAttendanceEmployees/);
  assert.match(runtime, /get_pos_bootstrap_core_v2/);
  assert.match(runtime, /get_attendance_employees/);
  assert.match(sharedRuntime, /auth\.getClaims\(token\)/);
  assert.match(sharedRuntime, /createNeonDataApiFetch/);
  assert.match(environment, /^TINDIO_ATTENDANCE_EMPLOYEES_READ_MODE=owned$/m);
});

test("owned attendance read preserves feature, permission, store, and mapping contracts", async () => {
  const owned = await read("apps/backend/src/pos/attendance-employees-owned.ts");

  for (const value of [
    "time_clock",
    "attendance.use",
    "Attendance is unavailable for this store.",
    "Choose one of your assigned stores.",
    "TINDIO could not load employees for attendance.",
    "employee_id",
    "employee_number",
    "pin_is_set",
    "entry_store_name",
    "clocked_in_at",
    "Assigned store",
    "private, no-store",
    "x-tindio-request-id",
  ]) {
    assert.match(owned, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.match(owned, /searchParams\.get\(["']store["']\)/);
  assert.doesNotMatch(owned, /service[_-]?role|DATABASE_URL/i);
});

test("attendance rollback is loop-safe, query-preserving, and allowlisted", async () => {
  const [service, proxy] = await Promise.all([
    read("apps/backend/src/pos/attendance-employees-service.ts"),
    read("apps/backend/src/pos/attendance-employees-proxy.ts"),
  ]);

  assert.match(service, /mode === ["']proxy["']/);
  assert.match(proxy, /POS_ATTENDANCE_EMPLOYEES_PATH\s*=\s*["']\/api\/pos\/v2\/attendance\/employees["']/);
  assert.match(proxy, /url\.search = requestUrl\.search/);
  assert.match(proxy, /upstream\.origin === requestUrl\.origin/);
  assert.match(proxy, /redirect:\s*["']manual["']/);
  assert.match(proxy, /cache:\s*["']no-store["']/);

  for (const header of [
    "accept",
    "authorization",
    "x-tindio-organization-id",
    "cache-control",
    "content-type",
    "retry-after",
    "x-tindio-request-id",
  ]) {
    assert.match(proxy, new RegExp(`["']${header}["']`));
  }
  assert.doesNotMatch(proxy, /headers\s*:\s*request\.headers|["']cookie["']/);
});

test("attendance employees use the focused cross-runtime contract", async () => {
  const [manifestSource, owned] = await Promise.all([
    read("packages/contracts/package.json"),
    read("apps/backend/src/pos/attendance-employees-owned.ts"),
  ]);
  const manifest = JSON.parse(manifestSource);

  assert.equal(manifest.exports["./attendance"].types, "./src/attendance.ts");
  assert.match(owned, /from ["']@tindio\/contracts\/attendance["']/);
  assert.doesNotMatch(owned, /from ["']@tindio\/contracts["']/);
});

test("Web rollback remains authoritative and attendance mutations stay in Next.js", async () => {
  const [employeesRoute, clockInRoute, clockOutRoute, mobileApi, readme] = await Promise.all([
    read("src/app/api/pos/v2/attendance/employees/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-in/route.ts"),
    read("src/app/api/pos/v2/attendance/clock-out/route.ts"),
    read("apps/mobile/src/lib/tindio-api.ts"),
    read("apps/backend/README.md"),
  ]);

  assert.match(employeesRoute, /loadAttendanceEmployees/);
  assert.match(clockInRoute, /clockIn/);
  assert.match(clockOutRoute, /clockOut/);
  assert.doesNotMatch(mobileApi, /TINDIO_WEB_API_ORIGIN|apps\/backend/);
  assert.match(readme, /No financial, custody, attendance, or offline-replayed mutation/);
});
