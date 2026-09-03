import "server-only";

import { clockInSchema, clockOutSchema } from "@/features/time-clock/time-clock-schema";
import type { TimeClockActionResult } from "@/features/time-clock/time-clock-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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
    return { ok: false, message: "Choose one of your assigned stores before clocking in." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_in_employee_with_pin", {
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
        "TINDIO could not clock this employee in.",
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
    return { ok: false, message: "Choose an employee and enter their 6–12 digit PIN." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_out_employee_with_pin", {
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
        "TINDIO could not clock this employee out.",
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
