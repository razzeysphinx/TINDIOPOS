import "server-only";

type ReadError = { message: string };

export type TimeClockBundle = {
  stores: Array<{ id: string; name: string; is_active: boolean }>;
  entries: Array<{ id: string; employee_id: string; store_id: string; clocked_in_at: string; clocked_out_at: string | null; clock_in_verification_method: string; clock_out_verification_method: string | null }>;
  employees: Array<{ id: string; profile_id: string; employee_number: string }>;
  profiles: Array<{ id: string; full_name: string | null; email: string | null }>;
  clockedInCount: number;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows<T>(record: Record<string, unknown>, key: string): T[] {
  return Array.isArray(record[key]) ? record[key] as T[] : [];
}

export async function loadTimeClockWorkspaceBundle(input: {
  client: { rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: ReadError | null }> };
  organizationId: string;
  storeIds: string[];
  filters?: { storeId?: string | null; employeeId?: string | null; start?: string | null; end?: string | null };
  includeAttendance: boolean;
}): Promise<{ data: TimeClockBundle; error: ReadError | null }> {
  const result = await input.client.rpc("get_time_clock_workspace_bundle_v1", {
    target_organization_id: input.organizationId,
    target_store_ids: input.storeIds,
    target_store_id: input.filters?.storeId ?? null,
    target_employee_id: input.filters?.employeeId ?? null,
    target_start: input.filters?.start ? `${input.filters.start}T00:00:00.000Z` : null,
    target_end: input.filters?.end ? `${input.filters.end}T23:59:59.999Z` : null,
    include_attendance: input.includeAttendance,
  });
  const record = recordOf(result.data);
  const count = record.clockedInCount;
  return { data: { stores: rows(record, "stores"), entries: rows(record, "entries"), employees: rows(record, "employees"), profiles: rows(record, "profiles"), clockedInCount: typeof count === "number" ? count : 0 }, error: result.error };
}
