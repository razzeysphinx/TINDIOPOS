"use server";

import { revalidatePath } from "next/cache";

import { clockInEmployee, clockOutEmployee } from "@/features/time-clock/service";
import type { TimeClockActionResult } from "@/features/time-clock/time-clock-types";
import { requireBusinessContext } from "@/lib/auth/dal";

function revalidateTimeClockViews() {
  revalidatePath("/back-office/time-clock");
  revalidatePath("/back-office");
  revalidatePath("/pos");
}

export async function clockInAction(input: unknown): Promise<TimeClockActionResult> {
  const context = await requireBusinessContext();
  if (!context.features.time_clock) {
    return { ok: false, message: "Time clock is disabled for this business." };
  }

  const result = await clockInEmployee({ context, input });
  if (result.ok) {
    revalidateTimeClockViews();
  }

  return result;
}

export async function clockOutAction(): Promise<TimeClockActionResult> {
  const context = await requireBusinessContext();
  if (!context.features.time_clock) {
    return { ok: false, message: "Time clock is disabled for this business." };
  }

  const result = await clockOutEmployee(context);
  if (result.ok) {
    revalidateTimeClockViews();
  }

  return result;
}
