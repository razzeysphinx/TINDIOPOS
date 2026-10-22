import "server-only";

import {
  POS_ATTENDANCE_CLOCK_IN_DATABASE_MESSAGE,
  POS_ATTENDANCE_CLOCK_IN_INPUT_MESSAGE,
  POS_ATTENDANCE_CLOCK_IN_RPC,
  POS_ATTENDANCE_CLOCK_OUT_DATABASE_MESSAGE,
  POS_ATTENDANCE_CLOCK_OUT_INPUT_MESSAGE,
  POS_ATTENDANCE_CLOCK_OUT_RPC,
} from "@tindio/contracts/attendance-mutation";
import { clockInSchema, clockOutSchema } from "@/features/time-clock/time-clock-schema";
import type { TimeClockActionResult } from "@/features/time-clock/time-clock-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createBusinessContextClient } from "@/lib/supabase/context-client";

function timeClockDatabaseMessage(
  code: string | undefined,
  message: string | undefined,
  fallback: string,
) {
  if (code === "42501" && message) return message;
  if ((code === "23505" || code === "23514" || code === "P0002") && message) return message;
  return fallback;
}

export async function clockInEmployee({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<TimeClockActionResult> {
  const parsed = clockInSchema.safeParse(input);

  if (!parsed.success || !context.storeIds.includes(parsed.data.storeId)) {
    return { ok: false, message: POS_ATTENDANCE_CLOCK_IN_INPUT_MESSAGE };
  }

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_ATTENDANCE_CLOCK_IN_RPC, {
    target_employee_id: parsed.data.employeeId,
    target_organization_id: context.organization.id,
    target_pin: parsed.data.pin,
    target_request_id: parsed.data.requestId,
    target_store_id: parsed.data.storeId,
  });
  const result = data?.[0];

  if (error || !result) {
    return {
      ok: false,
      message: timeClockDatabaseMessage(
        error?.code ?? undefined,
        error?.message ?? undefined,
        POS_ATTENDANCE_CLOCK_IN_DATABASE_MESSAGE,
      ),
    };
  }

  if (result.result_code !== "CLOCKED_IN" || !result.entry_id || !result.clocked_in_at) {
    return { ok: false, code: result.result_code, message: result.message };
  }

  return {
    ok: true,
    message: result.message,
    entry: {
      id: result.entry_id,
      employeeId: result.employee_id,
      employeeName: result.employee_name,
      storeId: result.store_id,
      storeName: result.store_name,
      clockedInAt: result.clocked_in_at,
      clockedOutAt: result.clocked_out_at,
    },
  };
}

export async function clockOutEmployee({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<TimeClockActionResult> {
  const parsed = clockOutSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: POS_ATTENDANCE_CLOCK_OUT_INPUT_MESSAGE };
  }

  const supabase = await createBusinessContextClient(context);
  const { data, error } = await supabase.rpc(POS_ATTENDANCE_CLOCK_OUT_RPC, {
    target_employee_id: parsed.data.employeeId,
    target_organization_id: context.organization.id,
    target_pin: parsed.data.pin,
    target_request_id: parsed.data.requestId,
  });
  const result = data?.[0];

  if (error || !result) {
    return {
      ok: false,
      message: timeClockDatabaseMessage(
        error?.code ?? undefined,
        error?.message ?? undefined,
        POS_ATTENDANCE_CLOCK_OUT_DATABASE_MESSAGE,
      ),
    };
  }

  if (result.result_code === "OPEN_REGISTER_SHIFT" && result.shift_id && result.register_id && result.register_name && result.shift_opened_at) {
    return {
      ok: false,
      code: result.result_code,
      message: result.message,
      openShift: {
        id: result.shift_id,
        registerId: result.register_id,
        registerName: result.register_name,
        openedAt: result.shift_opened_at,
      },
    };
  }

  if (result.result_code !== "CLOCKED_OUT" || !result.entry_id || !result.clocked_in_at || !result.clocked_out_at) {
    return { ok: false, code: result.result_code, message: result.message };
  }

  return {
    ok: true,
    message: result.message,
    entry: {
      id: result.entry_id,
      employeeId: result.employee_id,
      employeeName: result.employee_name,
      storeId: result.store_id,
      storeName: result.store_name,
      clockedInAt: result.clocked_in_at,
      clockedOutAt: result.clocked_out_at,
    },
  };
}
