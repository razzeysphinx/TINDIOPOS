import "server-only";

import type {
  AttendanceEmployee,
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
  context: BusinessContext,
  stores: TimeClockStoreOption[],
): TimeClockEntry | null {
  return data?.[0]
    ? {
        id: data[0].entry_id,
        employeeId: context.employee.id,
        employeeName: context.profile.full_name || context.profile.email || context.employee.employee_number,
        storeId: data[0].store_id,
        storeName: stores.find((store) => store.id === data[0].store_id)?.name ?? "Assigned store",
        clockedInAt: data[0].clocked_in_at,
      }
    : null;
}

export async function loadAttendanceEmployees(
  context: BusinessContext,
  storeId: string,
): Promise<AttendanceEmployee[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_attendance_employees", {
    target_organization_id: context.organization.id,
    target_store_id: storeId,
  });
  if (error) throw new Error(`Unable to load attendance employees: ${error.message}`);
  return (data ?? []).map((employee) => ({
    id: employee.employee_id,
    employeeNumber: employee.employee_number,
    name: employee.employee_name,
    pinIsSet: employee.pin_is_set,
    entry: employee.entry_id && employee.clocked_in_at && employee.entry_store_id
      ? {
          id: employee.entry_id,
          employeeId: employee.employee_id,
          employeeName: employee.employee_name,
          storeId: employee.entry_store_id,
          storeName: employee.entry_store_name ?? "Assigned store",
          clockedInAt: employee.clocked_in_at,
        }
      : null,
  }));
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

  const stores = (storesResult.data ?? []) as TimeClockStoreOption[];
  const employees = stores[0] ? await loadAttendanceEmployees(context, stores[0].id) : [];
  return { stores, employees, entry: mapCurrentEntry(entryResult.data, context, stores) };
}
