import "server-only";

import type {
  TimeClockEntry,
  TimeClockStoreOption,
  TimeClockWorkspace,
} from "@/features/time-clock/time-clock-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

function mapCurrentEntry(
  data: Array<{
    entry_id: string;
    store_id: string;
    clocked_in_at: string;
  }> | null,
): TimeClockEntry | null {
  return data?.[0]
    ? {
        id: data[0].entry_id,
        storeId: data[0].store_id,
        clockedInAt: data[0].clocked_in_at,
      }
    : null;
}

export async function loadTimeClockWorkspace(
  context: BusinessContext,
): Promise<TimeClockWorkspace> {
  const supabase = await createClient();
  const [storesResult, entryResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("id", context.storeIds)
      .order("name", { ascending: true }),
    supabase.rpc("get_current_time_clock_entry", {
      target_organization_id: context.organization.id,
    }),
  ]);

  if (storesResult.error || entryResult.error) {
    throw new Error(`Unable to load the time clock: ${storesResult.error?.message ?? entryResult.error?.message}`);
  }

  return {
    stores: (storesResult.data ?? []) as TimeClockStoreOption[],
    entry: mapCurrentEntry(entryResult.data),
  };
}
