import "server-only";

import { clockInSchema } from "@/features/time-clock/time-clock-schema";
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
  const { data, error } = await supabase.rpc("clock_in_employee", {
    target_organization_id: context.organization.id,
    target_store_id: parsed.data.storeId,
  });
  const entry = data?.[0];

  if (error || !entry) {
    return {
      ok: false,
      message: timeClockDatabaseMessage(
        error?.code ?? undefined,
        error?.message ?? undefined,
        "TINDIO could not clock you in.",
      ),
    };
  }

  return {
    ok: true,
    message: entry.was_replayed ? "You are already clocked in." : "You are clocked in.",
    entry: {
      id: entry.entry_id,
      storeId: entry.store_id,
      clockedInAt: entry.clocked_in_at,
    },
  };
}

export async function clockOutEmployee(
  context: BusinessContext,
): Promise<TimeClockActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_out_employee", {
    target_organization_id: context.organization.id,
  });

  if (error || !data?.[0]) {
    return {
      ok: false,
      message: timeClockDatabaseMessage(
        error?.code ?? undefined,
        error?.message ?? undefined,
        "TINDIO could not clock you out.",
      ),
    };
  }

  return { ok: true, message: "You are clocked out.", entry: null };
}
