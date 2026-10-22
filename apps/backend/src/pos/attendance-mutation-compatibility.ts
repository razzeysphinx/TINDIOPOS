import {
  POS_ATTENDANCE_CLOCK_IN_DATABASE_MESSAGE,
  POS_ATTENDANCE_CLOCK_IN_INPUT_MESSAGE,
  POS_ATTENDANCE_CLOCK_IN_PATH,
  POS_ATTENDANCE_CLOCK_IN_RPC,
  POS_ATTENDANCE_CLOCK_OUT_DATABASE_MESSAGE,
  POS_ATTENDANCE_CLOCK_OUT_INPUT_MESSAGE,
  POS_ATTENDANCE_CLOCK_OUT_PATH,
  POS_ATTENDANCE_CLOCK_OUT_RPC,
  POS_ATTENDANCE_DISABLED_MESSAGE,
  POS_ATTENDANCE_PERMISSION,
  POS_ATTENDANCE_REQUEST_INVALID_MESSAGE,
  clockInSchema,
  clockOutSchema,
  type AttendanceMutationResult,
  type AttendanceMutationRow,
  type ClockInValues,
  type ClockOutValues,
} from "@tindio/contracts/attendance-mutation";

export const ATTENDANCE_MUTATION_COMPATIBILITY_CONTRACT = {
  method: "POST",
  paths: {
    clockIn: POS_ATTENDANCE_CLOCK_IN_PATH,
    clockOut: POS_ATTENDANCE_CLOCK_OUT_PATH,
  },
  authentication: "supabase-business-context-before-json",
  organizationScope: "selected-header-or-authorized-default",
  routeOrder: "business-context-before-feature-and-permission-before-json-before-validation",
  permission: POS_ATTENDANCE_PERMISSION,
  rpcs: {
    clockIn: POS_ATTENDANCE_CLOCK_IN_RPC,
    clockOut: POS_ATTENDANCE_CLOCK_OUT_RPC,
  },
  clockInStoreCustody: "terminal-and-employee-assigned-to-requested-store",
  clockOutStoreCustody: "terminal-assigned-to-open-entry-store",
  idempotency: "organization-request-id-with-employee-and-store-drift-rejection",
  openShiftGuard: "employee-register-shift-must-close-before-clock-out",
  effects: "employee-pin-verification-time-entry-write-and-audit-log",
  actionResponses: {
    resultEnvelope: 200,
    malformedJson: 400,
    headers: { "cache-control": "private, no-store" },
  },
} as const;

export type AttendanceMutationContext = {
  timeClockEnabled: boolean;
  permissions: readonly string[];
  storeIds: readonly string[];
};

export function validateAttendanceMutationRoute(context: AttendanceMutationContext) {
  return context.timeClockEnabled && context.permissions.includes(POS_ATTENDANCE_PERMISSION)
    ? { ok: true as const }
    : {
        ok: false as const,
        result: { ok: false as const, message: POS_ATTENDANCE_DISABLED_MESSAGE },
      };
}

export function validateClockInMutation(
  value: unknown,
  storeIds: readonly string[],
): { ok: true; input: ClockInValues } | { ok: false; result: AttendanceMutationResult } {
  const parsed = clockInSchema.safeParse(value);
  return parsed.success && storeIds.includes(parsed.data.storeId)
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_ATTENDANCE_CLOCK_IN_INPUT_MESSAGE } };
}

export function validateClockOutMutation(
  value: unknown,
): { ok: true; input: ClockOutValues } | { ok: false; result: AttendanceMutationResult } {
  const parsed = clockOutSchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : { ok: false, result: { ok: false, message: POS_ATTENDANCE_CLOCK_OUT_INPUT_MESSAGE } };
}

export function toClockInRpcArguments(organizationId: string, input: ClockInValues) {
  return {
    target_employee_id: input.employeeId,
    target_organization_id: organizationId,
    target_pin: input.pin,
    target_request_id: input.requestId,
    target_store_id: input.storeId,
  };
}

export function toClockOutRpcArguments(organizationId: string, input: ClockOutValues) {
  return {
    target_employee_id: input.employeeId,
    target_organization_id: organizationId,
    target_pin: input.pin,
    target_request_id: input.requestId,
  };
}

function databaseFailure(
  error: { code?: string; message?: string } | null,
  fallback: string,
): AttendanceMutationResult {
  const passthroughCodes = new Set(["42501", "23505", "23514", "P0002"]);
  return {
    ok: false,
    message: error?.code && error.message && passthroughCodes.has(error.code)
      ? error.message
      : fallback,
  };
}

function entryFromRow(row: AttendanceMutationRow) {
  return {
    id: row.entry_id as string,
    employeeId: row.employee_id,
    employeeName: row.employee_name,
    storeId: row.store_id,
    storeName: row.store_name,
    clockedInAt: row.clocked_in_at as string,
    clockedOutAt: row.clocked_out_at,
  };
}

export function mapClockInRpcResult(
  row: AttendanceMutationRow | null,
  error: { code?: string; message?: string } | null,
): AttendanceMutationResult {
  if (error || !row) return databaseFailure(error, POS_ATTENDANCE_CLOCK_IN_DATABASE_MESSAGE);
  if (row.result_code !== "CLOCKED_IN" || !row.entry_id || !row.clocked_in_at) {
    return { ok: false, code: row.result_code, message: row.message };
  }
  return { ok: true, message: row.message, entry: entryFromRow(row) };
}

export function mapClockOutRpcResult(
  row: AttendanceMutationRow | null,
  error: { code?: string; message?: string } | null,
): AttendanceMutationResult {
  if (error || !row) return databaseFailure(error, POS_ATTENDANCE_CLOCK_OUT_DATABASE_MESSAGE);
  if (
    row.result_code === "OPEN_REGISTER_SHIFT"
    && row.shift_id
    && row.register_id
    && row.register_name
    && row.shift_opened_at
  ) {
    return {
      ok: false,
      code: row.result_code,
      message: row.message,
      openShift: {
        id: row.shift_id,
        registerId: row.register_id,
        registerName: row.register_name,
        openedAt: row.shift_opened_at,
      },
    };
  }
  if (
    row.result_code !== "CLOCKED_OUT"
    || !row.entry_id
    || !row.clocked_in_at
    || !row.clocked_out_at
  ) {
    return { ok: false, code: row.result_code, message: row.message };
  }
  return { ok: true, message: row.message, entry: entryFromRow(row) };
}

export const ATTENDANCE_MUTATION_ROUTE_MESSAGES = {
  malformedJson: POS_ATTENDANCE_REQUEST_INVALID_MESSAGE,
  disabled: POS_ATTENDANCE_DISABLED_MESSAGE,
} as const;
