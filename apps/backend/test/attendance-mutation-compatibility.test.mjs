import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT,
  ATTENDANCE_MUTATION_ROUTE_MESSAGES,
  mapClockInRpcResult,
  mapClockOutRpcResult,
  toClockInRpcArguments,
  toClockOutRpcArguments,
  validateAttendanceMutationRoute,
  validateClockInMutation,
  validateClockOutMutation,
} from "../dist/src/pos/attendance-mutation-compatibility.js";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const STORE_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_STORE_ID = "10000000-0000-4000-8000-000000000002";
const EMPLOYEE_ID = "20000000-0000-4000-8000-000000000001";
const REQUEST_ID = "30000000-0000-4000-8000-000000000001";
const ENTRY_ID = "40000000-0000-4000-8000-000000000001";
const SHIFT_ID = "50000000-0000-4000-8000-000000000001";
const REGISTER_ID = "60000000-0000-4000-8000-000000000001";

const CLOCK_IN = { storeId: STORE_ID, employeeId: EMPLOYEE_ID, pin: "123456", requestId: REQUEST_ID };
const CLOCK_OUT = { employeeId: EMPLOYEE_ID, pin: "123456", requestId: REQUEST_ID };
const ROW = {
  result_code: "CLOCKED_IN",
  message: "Employee clocked in.",
  entry_id: ENTRY_ID,
  employee_id: EMPLOYEE_ID,
  employee_name: "Alex Cashier",
  store_id: STORE_ID,
  store_name: "Main Store",
  clocked_in_at: "2026-10-22T01:00:00.000Z",
  clocked_out_at: null,
  was_replayed: false,
  shift_id: null,
  register_id: null,
  register_name: null,
  shift_opened_at: null,
};

test("attendance mutations freeze routes, custody, effects, and response status", () => {
  assert.deepEqual(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.paths, {
    clockIn: "/api/pos/v2/attendance/clock-in",
    clockOut: "/api/pos/v2/attendance/clock-out",
  });
  assert.equal(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.method, "POST");
  assert.equal(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.permission, "attendance.use");
  assert.deepEqual(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.rpcs, {
    clockIn: "clock_in_employee_with_pin",
    clockOut: "clock_out_employee_with_pin",
  });
  assert.equal(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.clockInStoreCustody, "terminal-and-employee-assigned-to-requested-store");
  assert.equal(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.clockOutStoreCustody, "terminal-assigned-to-open-entry-store");
  assert.equal(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.openShiftGuard, "employee-register-shift-must-close-before-clock-out");
  assert.deepEqual(ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT.actionResponses, {
    resultEnvelope: 200,
    malformedJson: 400,
    headers: { "cache-control": "private, no-store" },
  });
  assert.deepEqual(ATTENDANCE_MUTATION_ROUTE_MESSAGES, {
    malformedJson: "The request data is invalid.",
    disabled: "Time clock is disabled for this business.",
  });
});

test("attendance route gate preserves feature-or-permission failure precedence", () => {
  assert.deepEqual(validateAttendanceMutationRoute({ timeClockEnabled: false, permissions: [], storeIds: [] }), {
    ok: false,
    result: { ok: false, message: "Time clock is disabled for this business." },
  });
  assert.deepEqual(validateAttendanceMutationRoute({ timeClockEnabled: true, permissions: [], storeIds: [] }), {
    ok: false,
    result: { ok: false, message: "Time clock is disabled for this business." },
  });
  assert.deepEqual(validateAttendanceMutationRoute({ timeClockEnabled: true, permissions: ["attendance.use"], storeIds: [STORE_ID] }), { ok: true });
});

test("clock-in validates UUIDs, PIN bounds, and assigned-store custody", () => {
  assert.deepEqual(validateClockInMutation(CLOCK_IN, [STORE_ID]), { ok: true, input: CLOCK_IN });
  for (const value of [
    null,
    { ...CLOCK_IN, employeeId: "bad" },
    { ...CLOCK_IN, requestId: "bad" },
    { ...CLOCK_IN, pin: "12345" },
    { ...CLOCK_IN, pin: "1234567890123" },
    { ...CLOCK_IN, pin: "12345x" },
  ]) {
    assert.deepEqual(validateClockInMutation(value, [STORE_ID]), {
      ok: false,
      result: { ok: false, message: "Choose one of your assigned stores before clocking in." },
    });
  }
  assert.deepEqual(validateClockInMutation({ ...CLOCK_IN, storeId: OTHER_STORE_ID }, [STORE_ID]), {
    ok: false,
    result: { ok: false, message: "Choose one of your assigned stores before clocking in." },
  });
});

test("clock-out validates UUIDs and employee PIN bounds", () => {
  assert.deepEqual(validateClockOutMutation(CLOCK_OUT), { ok: true, input: CLOCK_OUT });
  for (const value of [null, { ...CLOCK_OUT, employeeId: "bad" }, { ...CLOCK_OUT, pin: "12345x" }]) {
    assert.deepEqual(validateClockOutMutation(value), {
      ok: false,
      result: { ok: false, message: "Choose an employee and enter their 6–12 digit PIN." },
    });
  }
});

test("attendance mutations preserve exact RPC projections", () => {
  assert.deepEqual(toClockInRpcArguments(ORGANIZATION_ID, CLOCK_IN), {
    target_employee_id: EMPLOYEE_ID,
    target_organization_id: ORGANIZATION_ID,
    target_pin: "123456",
    target_request_id: REQUEST_ID,
    target_store_id: STORE_ID,
  });
  assert.deepEqual(toClockOutRpcArguments(ORGANIZATION_ID, CLOCK_OUT), {
    target_employee_id: EMPLOYEE_ID,
    target_organization_id: ORGANIZATION_ID,
    target_pin: "123456",
    target_request_id: REQUEST_ID,
  });
});

test("attendance database errors preserve approved business detail only", () => {
  for (const code of ["42501", "23505", "23514", "P0002"]) {
    assert.deepEqual(mapClockInRpcResult(null, { code, message: "Database business rule." }), {
      ok: false,
      message: "Database business rule.",
    });
  }
  assert.deepEqual(mapClockInRpcResult(null, { code: "XX000", message: "provider detail" }), {
    ok: false,
    message: "TINDIO could not clock this employee in.",
  });
  assert.deepEqual(mapClockOutRpcResult(null, null), {
    ok: false,
    message: "TINDIO could not clock this employee out.",
  });
});

test("clock-in maps successful, replayed, and business-code rows", () => {
  const result = {
    ok: true,
    message: "Employee clocked in.",
    entry: {
      id: ENTRY_ID,
      employeeId: EMPLOYEE_ID,
      employeeName: "Alex Cashier",
      storeId: STORE_ID,
      storeName: "Main Store",
      clockedInAt: "2026-10-22T01:00:00.000Z",
      clockedOutAt: null,
    },
  };
  assert.deepEqual(mapClockInRpcResult(ROW, null), result);
  assert.deepEqual(mapClockInRpcResult({ ...ROW, was_replayed: true, message: "This employee is already clocked in." }, null), {
    ...result,
    message: "This employee is already clocked in.",
  });
  assert.deepEqual(mapClockInRpcResult({ ...ROW, result_code: "INVALID_PIN", entry_id: null, clocked_in_at: null, message: "Incorrect employee PIN." }, null), {
    ok: false,
    code: "INVALID_PIN",
    message: "Incorrect employee PIN.",
  });
});

test("clock-out maps the open-register guard and completed entry", () => {
  assert.deepEqual(mapClockOutRpcResult({
    ...ROW,
    result_code: "OPEN_REGISTER_SHIFT",
    message: "Close the register shift before clocking out.",
    shift_id: SHIFT_ID,
    register_id: REGISTER_ID,
    register_name: "Register 1",
    shift_opened_at: "2026-10-22T00:30:00.000Z",
  }, null), {
    ok: false,
    code: "OPEN_REGISTER_SHIFT",
    message: "Close the register shift before clocking out.",
    openShift: {
      id: SHIFT_ID,
      registerId: REGISTER_ID,
      registerName: "Register 1",
      openedAt: "2026-10-22T00:30:00.000Z",
    },
  });
  assert.deepEqual(mapClockOutRpcResult({
    ...ROW,
    result_code: "CLOCKED_OUT",
    message: "Employee clocked out.",
    clocked_out_at: "2026-10-22T09:00:00.000Z",
  }, null), {
    ok: true,
    message: "Employee clocked out.",
    entry: {
      id: ENTRY_ID,
      employeeId: EMPLOYEE_ID,
      employeeName: "Alex Cashier",
      storeId: STORE_ID,
      storeName: "Main Store",
      clockedInAt: "2026-10-22T01:00:00.000Z",
      clockedOutAt: "2026-10-22T09:00:00.000Z",
    },
  });
});
