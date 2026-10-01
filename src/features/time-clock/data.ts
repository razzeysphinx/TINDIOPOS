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
import { createBusinessContextClient } from "@/lib/supabase/context-client";
import { loadTimeClockWorkspaceBundle } from "@/features/time-clock/time-clock-read-model";

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
  const supabase = await createBusinessContextClient(context);
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
  const supabase = await createBusinessContextClient(context);
  const [bundleResult, entryResult] = await Promise.all([
    loadTimeClockWorkspaceBundle({ client: supabase as unknown as Parameters<typeof loadTimeClockWorkspaceBundle>[0]["client"], organizationId: context.organization.id, storeIds: context.storeIds, includeAttendance: false }),
    supabase.rpc("get_current_time_clock_entry", {
      target_organization_id: context.organization.id,
    }),
  ]);

  if (bundleResult.error || entryResult.error) {
    throw new Error(`Unable to load the time clock: ${bundleResult.error?.message ?? entryResult.error?.message}`);
  }

  const stores = bundleResult.data.stores.filter((store) => store.is_active).map(({ id, name }) => ({ id, name })) as TimeClockStoreOption[];
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
  const supabase = await createBusinessContextClient(context);
  const bundleResult = await loadTimeClockWorkspaceBundle({ client: supabase as unknown as Parameters<typeof loadTimeClockWorkspaceBundle>[0]["client"], organizationId: context.organization.id, storeIds: context.storeIds, filters, includeAttendance: true });
  if (bundleResult.error) throw new Error(`Unable to load time and attendance: ${bundleResult.error.message}`);
  const { entries: entryRows, employees, stores: storeRows, profiles: profileRows, clockedInCount } = bundleResult.data;
  const profiles = new Map(profileRows.map((profile) => [profile.id, profile]));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const storeById = new Map(storeRows.map((store) => [store.id, store.name]));
  const employeeOptions: TimeAttendanceEmployeeOption[] = employees.map((employee) => {
    const profile = profiles.get(employee.profile_id);
    return {
      id: employee.id,
      name: profile?.full_name || profile?.email || employee.employee_number,
      employeeNumber: employee.employee_number,
    };
  });
  const entries: TimeAttendanceEntry[] = entryRows.map((entry) => {
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
    stores: storeRows
      .filter((store) => store.is_active)
      .map((store) => ({ id: store.id, name: store.name })),
    clockedInCount,
  };
}
