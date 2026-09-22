"use server";

import { revalidatePath } from "next/cache";

import {
  closeShift,
  openShift,
  recordCashMovement,
  type OpenShiftActionResult,
  type ShiftActionResult,
} from "@/features/shifts/service";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type { OpenShiftActionResult, ShiftActionResult } from "@/features/shifts/service";

function revalidateShiftViews() {
  revalidatePath("/back-office/shifts");
  revalidatePath("/pos");
}

function databaseMessage(
  code: string | undefined,
  message: string | undefined,
  fallback: string,
) {
  if (code === "42501" && message?.toLowerCase().includes("device")) return message;
  if (code === "42501") return "You do not have permission for this cash operation.";
  if (code === "23505" && message === "This register already has an open shift.") {
    return "This register has an open shift. Ask a staff member with Shift closing permission to review and close it before opening another.";
  }
  if (code === "23505" && message) return message;
  if ((code === "23514" || code === "P0002") && message) return message;
  return fallback;
}

export async function openShiftAction(input: unknown): Promise<OpenShiftActionResult> {
  const context = await requireBusinessContext();
  const result = await openShift({ context, input });
  if (result.ok) revalidateShiftViews();
  return result;
}

export async function closeShiftAction(input: unknown): Promise<ShiftActionResult> {
  const context = await requireBusinessContext();
  const result = await closeShift({ context, input });
  if (result.ok) revalidateShiftViews();
  return result;
}

export async function updateShiftCashCloseSettingAction(
  showExpectedCashBeforeClose: boolean,
): Promise<ShiftActionResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "settings.manage")) {
    return { ok: false, message: "You do not have permission to change cash-close settings." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("update_shift_cash_close_setting", {
    target_organization_id: context.organization.id,
    target_show_expected_cash_before_close: showExpectedCashBeforeClose,
  });

  if (error || data !== showExpectedCashBeforeClose) {
    return {
      ok: false,
      message: databaseMessage(
        error?.code,
        error?.message,
        "TINDIO could not update the cash-close setting.",
      ),
    };
  }

  revalidateShiftViews();
  return {
    ok: true,
    message: showExpectedCashBeforeClose
      ? "Expected cash will be visible before a shift is closed."
      : "Blind cash counting is enabled. Expected cash stays hidden until close.",
  };
}

export async function recordCashMovementAction(input: unknown): Promise<ShiftActionResult> {
  const context = await requireBusinessContext();
  const result = await recordCashMovement({ context, input });
  if (result.ok) revalidateShiftViews();
  return result;
}
