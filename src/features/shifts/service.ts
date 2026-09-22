import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import { posDeviceRequestHeaders } from "@/features/devices/device-schema";
import {
  cashMovementSchema,
  closeShiftSchema,
  openShiftSubmissionSchema,
} from "@/features/shifts/shift-schema";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

export type ShiftActionResult =
  | {
      ok: true;
      message: string;
      closeSummary?: {
        expectedCashMinor: number;
        countedCashMinor: number;
        differenceMinor: number;
      };
    }
  | { ok: false; message: string };

export type OpenShiftActionResult =
  | {
      ok: true;
      message: string;
      shift: {
        id: string;
        storeId: string;
        registerId: string;
        openingCashMinor: number;
        openedAt: string;
      };
    }
  | { ok: false; message: string };

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

export async function openShift({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<OpenShiftActionResult> {
  if (!hasPermission(context, "shifts.open")) {
    return { ok: false, message: "You do not have permission to open register shifts." };
  }

  const parsed = openShiftSubmissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose an assigned register and enter a valid opening cash amount." };
  }

  const supabase = await createBusinessContextClient(context, { headers: posDeviceRequestHeaders(parsed.data.device) });
  const { data, error } = await supabase.rpc("open_register_shift", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
    target_register_id: parsed.data.registerId,
    target_opening_cash_minor: moneyInputToMinor(parsed.data.openingCash),
    target_opening_note: (parsed.data.openingNote || null) as never,
  });

  if (error || !data?.[0]) {
    return {
      ok: false,
      message: databaseMessage(error?.code, error?.message, "TINDIO could not open this register shift."),
    };
  }

  return {
    ok: true,
    message: data[0].was_replayed ? "This shift is already open." : "Register shift opened.",
    shift: {
      id: data[0].shift_id,
      storeId: parsed.data.storeId,
      registerId: parsed.data.registerId,
      openingCashMinor: moneyInputToMinor(parsed.data.openingCash),
      openedAt: data[0].opened_at,
    },
  };
}

export async function closeShift({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<ShiftActionResult> {
  if (!hasPermission(context, "shifts.close")) {
    return { ok: false, message: "You do not have permission to close register shifts." };
  }

  const parsed = closeShiftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter the counted cash as a valid non-negative amount." };
  }

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc("close_register_shift", {
    target_organization_id: context.organization.id,
    target_shift_id: parsed.data.shiftId,
    target_counted_cash_minor: moneyInputToMinor(parsed.data.countedCash),
    target_closing_note: (parsed.data.closingNote || null) as never,
  });

  if (error || !data?.[0]) {
    return {
      ok: false,
      message: databaseMessage(error?.code, error?.message, "TINDIO could not close this register shift."),
    };
  }

  return {
    ok: true,
    message: "Shift closed and cash difference recorded.",
    closeSummary: {
      expectedCashMinor: data[0].expected_cash_minor,
      countedCashMinor: data[0].counted_cash_minor,
      differenceMinor: data[0].difference_minor,
    },
  };
}

export async function recordCashMovement({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<ShiftActionResult> {
  const parsed = cashMovementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Enter a positive amount and a reason of at least two characters." };
  }

  const requiredPermission = parsed.data.movementType === "PAY_IN" ? "cash.pay_in" : "cash.pay_out";
  if (!hasPermission(context, requiredPermission) && !parsed.data.approvalRequestId) {
    return { ok: false, message: "You do not have permission for this cash movement." };
  }

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc("record_cash_movement", {
    target_organization_id: context.organization.id,
    target_shift_id: parsed.data.shiftId,
    target_movement_type: parsed.data.movementType,
    target_amount_minor: moneyInputToMinor(parsed.data.amount),
    target_reason: parsed.data.reason,
    target_idempotency_key: parsed.data.idempotencyKey,
    ...(parsed.data.approvalRequestId
      ? { target_approval_request_id: parsed.data.approvalRequestId }
      : {}),
  });

  if (error || !data?.[0]) {
    return {
      ok: false,
      message: databaseMessage(error?.code, error?.message, "TINDIO could not record this cash movement."),
    };
  }

  return {
    ok: true,
    message: data[0].was_replayed ? "That cash movement was already recorded." : "Cash movement recorded.",
  };
}
