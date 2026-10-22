import { z } from "zod";

import type { TimeClockActionResult } from "./attendance.js";

export const POS_ATTENDANCE_CLOCK_IN_PATH = "/api/pos/v2/attendance/clock-in" as const;
export const POS_ATTENDANCE_CLOCK_OUT_PATH = "/api/pos/v2/attendance/clock-out" as const;
export const POS_ATTENDANCE_CLOCK_IN_RPC = "clock_in_employee_with_pin" as const;
export const POS_ATTENDANCE_CLOCK_OUT_RPC = "clock_out_employee_with_pin" as const;
export const POS_ATTENDANCE_PERMISSION = "attendance.use" as const;

export const POS_ATTENDANCE_DISABLED_MESSAGE =
  "Time clock is disabled for this business." as const;
export const POS_ATTENDANCE_REQUEST_INVALID_MESSAGE =
  "The request data is invalid." as const;
export const POS_ATTENDANCE_CLOCK_IN_INPUT_MESSAGE =
  "Choose one of your assigned stores before clocking in." as const;
export const POS_ATTENDANCE_CLOCK_OUT_INPUT_MESSAGE =
  "Choose an employee and enter their 6\u201312 digit PIN." as const;
export const POS_ATTENDANCE_CLOCK_IN_DATABASE_MESSAGE =
  "TINDIO could not clock this employee in." as const;
export const POS_ATTENDANCE_CLOCK_OUT_DATABASE_MESSAGE =
  "TINDIO could not clock this employee out." as const;

const attendancePinSchema = z
  .string()
  .regex(/^\d{6,12}$/, "Use a 6\u201312 digit PIN.");

export const clockInSchema = z.object({
  storeId: z.uuid(),
  employeeId: z.uuid(),
  pin: attendancePinSchema,
  requestId: z.uuid(),
});

export const clockOutSchema = z.object({
  employeeId: z.uuid(),
  pin: attendancePinSchema,
  requestId: z.uuid(),
});

export type ClockInValues = z.infer<typeof clockInSchema>;
export type ClockOutValues = z.infer<typeof clockOutSchema>;
export type AttendanceMutationResult = TimeClockActionResult;

export type AttendanceMutationRow = {
  result_code: string;
  message: string;
  entry_id: string | null;
  employee_id: string;
  employee_name: string;
  store_id: string;
  store_name: string;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
  was_replayed: boolean;
  shift_id: string | null;
  register_id: string | null;
  register_name: string | null;
  shift_opened_at: string | null;
};
