import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Back Office Time & Attendance is an audit surface, while POS retains employee self-service", async () => {
  const [timeAttendancePage, posDrawer, policy] = await Promise.all([
    read("src/app/(back-office)/back-office/time-clock/page.tsx"),
    read("src/features/pos/pos-operational-drawer.tsx"),
    read("supabase/migrations/20260904083000_time_attendance_management_scope.sql"),
  ]);

  assert.match(timeAttendancePage, /requireBackOfficePermission\("employees\.manage"\)/);
  assert.match(timeAttendancePage, /loadTimeAttendanceWorkspace/);
  assert.match(timeAttendancePage, /GlobalFilterBar/);
  assert.match(timeAttendancePage, /Employee/);
  assert.doesNotMatch(timeAttendancePage, /TimeClockControl/);
  assert.match(posDrawer, /<TimeClockControl/);
  assert.match(policy, /employees\.manage/);
  assert.match(policy, /private\.has_store_read_scope/);
});

test("the employee list is one compact list and abbreviates long store assignments", async () => {
  const employeesPage = await read("src/app/(back-office)/back-office/employees/page.tsx");

  assert.match(employeesPage, /function formatStoreAssignment/);
  assert.match(employeesPage, /\+\$\{storeNames\.length - 3\} more/);
  assert.match(employeesPage, /aria-label="Employees" className="overflow-hidden rounded-2xl border bg-card"/);
  assert.doesNotMatch(employeesPage, /section className="grid gap-4 lg:grid-cols-2"/);
  assert.match(employeesPage, /href=\{`\/back-office\/employees\/\$\{employee\.id\}`\}/);
});
