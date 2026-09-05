import "server-only";

import type {
  AttendanceEmployee,
  TimeAttendanceEmployeeOption,
  TimeAttendanceEntry,
  TimeAttendanceWorkspace,
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

/**
 * Back Office audit data. This deliberately reads the canonical attendance
 * records; clock-in/out operations remain in the POS employee workflow.
 */
export async function loadTimeAttendanceWorkspace(
  context: BusinessContext,
  filters: { storeId?: string | null; employeeId?: string | null; start?: string | null; end?: string | null },
): Promise<TimeAttendanceWorkspace> {
  const supabase = await createClient();
  let entriesQuery = supabase
    .from("time_clock_entries")
    .select("id, employee_id, store_id, clocked_in_at, clocked_out_at, clock_in_verification_method, clock_out_verification_method")
    .eq("organization_id", context.organization.id)
    .order("clocked_in_at", { ascending: false })
    .limit(200);

  if (filters.storeId) entriesQuery = entriesQuery.eq("store_id", filters.storeId);
  if (filters.employeeId) entriesQuery = entriesQuery.eq("employee_id", filters.employeeId);
  if (filters.start) entriesQuery = entriesQuery.gte("clocked_in_at", `${filters.start}T00:00:00.000Z`);
  if (filters.end) entriesQuery = entriesQuery.lte("clocked_in_at", `${filters.end}T23:59:59.999Z`);

  const [entriesResult, employeesResult, storesResult, clockedInResult] = await Promise.all([
    entriesQuery,
    supabase
      .from("employees")
      .select("id, profile_id, employee_number")
      .eq("organization_id", context.organization.id)
      .order("employee_number", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", context.organization.id)
      .in("id", context.storeIds)
      .order("name", { ascending: true }),
    supabase
      .from("time_clock_entries")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", context.organization.id)
      .is("clocked_out_at", null),
  ]);

  const baseError = [entriesResult, employeesResult, storesResult, clockedInResult].find((result) => result.error)?.error;
  if (baseError) throw new Error(`Unable to load time and attendance: ${baseError.message}`);

  const employees = employeesResult.data ?? [];
  const profileIds = employees.map((employee) => employee.profile_id);
  const profilesResult = profileIds.length > 0
    ? await supabase.from("profiles").select("id, full_name, email").in("id", profileIds)
    : { data: [], error: null };
  if (profilesResult.error) throw new Error(`Unable to load attendance employees: ${profilesResult.error.message}`);

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const storeById = new Map((storesResult.data ?? []).map((store) => [store.id, store.name]));
  const employeeOptions: TimeAttendanceEmployeeOption[] = employees.map((employee) => {
    const profile = profiles.get(employee.profile_id);
    return {
      id: employee.id,
      name: profile?.full_name || profile?.email || employee.employee_number,
      employeeNumber: employee.employee_number,
    };
  });
  const entries: TimeAttendanceEntry[] = (entriesResult.data ?? []).map((entry) => {
    const employee = employeeById.get(entry.employee_id);
    const profile = employee ? profiles.get(employee.profile_id) : undefined;
    return {
      id: entry.id,
      employeeId: entry.employee_id,
      employeeName: profile?.full_name || profile?.email || employee?.employee_number || "Unknown employee",
      employeeNumber: employee?.employee_number || "—",
      storeId: entry.store_id,
      storeName: storeById.get(entry.store_id) ?? "Assigned store",
      clockedInAt: entry.clocked_in_at,
      clockedOutAt: entry.clocked_out_at,
      clockInVerificationMethod: entry.clock_in_verification_method,
      clockOutVerificationMethod: entry.clock_out_verification_method,
    };
  });

  return {
    entries,
    employees: employeeOptions,
    stores: (storesResult.data ?? [])
      .filter((store) => store.is_active)
      .map((store) => ({ id: store.id, name: store.name })),
    clockedInCount: clockedInResult.count ?? 0,
  };
}
