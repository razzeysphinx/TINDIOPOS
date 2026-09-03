"use server";

import { revalidatePath } from "next/cache";

import { attendanceStoreSchema } from "@/features/time-clock/time-clock-schema";
import { loadAttendanceEmployees } from "@/features/time-clock/data";
import { clockInEmployee, clockOutEmployee } from "@/features/time-clock/service";
import type { AttendanceEmployeesResult, TimeClockActionResult } from "@/features/time-clock/time-clock-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

function revalidateTimeClockViews() {
  revalidatePath("/back-office/time-clock");
  revalidatePath("/back-office");
  revalidatePath("/pos");
}

export async function clockInAction(input: unknown): Promise<TimeClockActionResult> {
  const context = await requireBusinessContext();
  if (!context.features.time_clock || !hasPermission(context, "attendance.use")) {
    return { ok: false, message: "Time clock is disabled for this business." };
  }

  const result = await clockInEmployee({ context, input });
  if (result.ok) {
    revalidateTimeClockViews();
  }

  return result;
}

export async function clockOutAction(input: unknown): Promise<TimeClockActionResult> {
  const context = await requireBusinessContext();
  if (!context.features.time_clock || !hasPermission(context, "attendance.use")) {
    return { ok: false, message: "Time clock is disabled for this business." };
  }

  const result = await clockOutEmployee({ context, input });
  if (result.ok) {
    revalidateTimeClockViews();
  }

  return result;
}

export async function loadAttendanceEmployeesAction(input: unknown): Promise<AttendanceEmployeesResult> {
  const context = await requireBusinessContext();
  const parsed = attendanceStoreSchema.safeParse(input);
  if (!parsed.success || !context.features.time_clock || !hasPermission(context, "attendance.use")) {
    return { ok: false, message: "Attendance is unavailable for this store.", employees: [] };
  }
  if (!context.storeIds.includes(parsed.data.storeId)) {
    return { ok: false, message: "Choose one of your assigned stores.", employees: [] };
  }
  try {
    return { ok: true, employees: await loadAttendanceEmployees(context, parsed.data.storeId) };
  } catch {
    return { ok: false, message: "TINDIO could not load employees for attendance.", employees: [] };
  }
}
