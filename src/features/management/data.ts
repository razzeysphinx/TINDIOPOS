import "server-only";

import type {
  ManagementDisplaySessionRow,
  ManagementEmployeesWorkspace,
  ManagementRegisterDrawerData,
  ManagementRegisterOperationalDrawerData,
  ManagementRegistersWorkspace,
  ManagementStoreDrawerData,
  ManagementRolesWorkspace,
  ManagementStoreRegisterOverviewRow,
  ManagementStoreRow,
} from "@/features/management/management-types";
import {
  hasAnyPermission,
  hasOrganizationWideStoreScope,
  hasPermission,
  hasStoreAccess,
  type BusinessContext,
} from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export async function loadManagementStores(
  context: BusinessContext,
): Promise<ManagementStoreRow[]> {
  const supabase = await createClient();
  const { data: stores, error } = await supabase
    .from("stores")
    .select("id, name, code, address, phone, is_active, created_at")
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Unable to load stores: ${error.message}`);
  }

  return stores;
}

export async function loadManagementRegisters(
  context: BusinessContext,
  options: { includeDisplaySessions?: boolean } = {},
): Promise<ManagementRegistersWorkspace> {
  const supabase = await createClient();
  const [registerResult, storeResult, displaySessionsResult] = await Promise.all([
    supabase
      .from("registers")
      .select("id, store_id, name, code, is_active, created_at")
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", context.organization.id),
    options.includeDisplaySessions
      ? supabase.rpc("get_customer_display_management_sessions", {
          target_organization_id: context.organization.id,
        })
      : Promise.resolve({
          data: [] as ManagementDisplaySessionRow[],
          error: null,
        }),
  ]);

  if (registerResult.error || storeResult.error || displaySessionsResult.error) {
    throw new Error(
      `Unable to load registers: ${registerResult.error?.message ?? storeResult.error?.message ?? displaySessionsResult.error?.message}`,
    );
  }

  return {
    registers: registerResult.data,
    stores: storeResult.data,
    displaySessions: displaySessionsResult.data ?? [],
  };
}

/**
 * Lightweight, store-first operational context. Detailed shift cash and device
 * state intentionally stay out of this overview and load only in later drawers.
 */
export async function loadManagementStoreRegisterOverview(
  context: BusinessContext,
): Promise<ManagementStoreRegisterOverviewRow[]> {
  const supabase = await createClient();
  const assignedStoreIds = [...new Set(context.storeIds)];
  const canAccessAllStores = hasOrganizationWideStoreScope(context);
  const canViewOpenShifts = hasPermission(context, "settings.manage")
    || hasAnyPermission(context, ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"]);
  const canViewDeviceState = hasPermission(context, "devices.manage");

  if (!canAccessAllStores && assignedStoreIds.length === 0) return [];

  let storesQuery = supabase
    .from("stores")
    .select("id, name, code, address, phone, is_active")
    .eq("organization_id", context.organization.id)
    .order("created_at", { ascending: true });
  let registersQuery = supabase
    .from("registers")
    .select("store_id")
    .eq("organization_id", context.organization.id);

  if (!canAccessAllStores) {
    storesQuery = storesQuery.in("id", assignedStoreIds);
    registersQuery = registersQuery.in("store_id", assignedStoreIds);
  }

  const shiftsQuery = canViewOpenShifts
    ? supabase
        .from("shifts")
        .select("store_id")
        .eq("organization_id", context.organization.id)
        .eq("status", "open")
    : null;
  const devicesQuery = canViewDeviceState
    ? supabase
        .from("pos_devices")
        .select("store_id")
        .eq("organization_id", context.organization.id)
        .eq("status", "active")
    : null;
  const syncIssuesQuery = canViewDeviceState
    ? supabase
        .from("offline_sync_events")
        .select("store_id")
        .eq("organization_id", context.organization.id)
        .in("state", ["CONFLICT", "FAILED"])
    : null;

  if (!canAccessAllStores) {
    shiftsQuery?.in("store_id", assignedStoreIds);
    devicesQuery?.in("store_id", assignedStoreIds);
    syncIssuesQuery?.in("store_id", assignedStoreIds);
  }

  const [storesResult, registersResult, shiftsResult, devicesResult, syncIssuesResult] = await Promise.all([
    storesQuery,
    registersQuery,
    shiftsQuery ?? Promise.resolve({ data: [], error: null }),
    devicesQuery ?? Promise.resolve({ data: [], error: null }),
    syncIssuesQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  const error = [storesResult, registersResult, shiftsResult, devicesResult, syncIssuesResult]
    .find((result) => result.error)?.error;
  if (error) throw new Error("Unable to load stores and registers: " + error.message);

  const countByStore = (rows: Array<{ store_id: string }>) => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.store_id, (counts.get(row.store_id) ?? 0) + 1);
    return counts;
  };

  const registerCounts = countByStore(registersResult.data ?? []);
  const openShiftCounts = countByStore(shiftsResult.data ?? []);
  const activeDeviceCounts = countByStore(devicesResult.data ?? []);
  const syncIssueCounts = countByStore(syncIssuesResult.data ?? []);

  return (storesResult.data ?? []).map((store) => ({
    id: store.id,
    name: store.name,
    code: store.code,
    address: store.address,
    phone: store.phone,
    isActive: store.is_active,
    registerCount: registerCounts.get(store.id) ?? 0,
    openShiftCount: canViewOpenShifts ? openShiftCounts.get(store.id) ?? 0 : null,
    activeDeviceCount: canViewDeviceState ? activeDeviceCounts.get(store.id) ?? 0 : null,
    syncIssueCount: canViewDeviceState ? syncIssueCounts.get(store.id) ?? 0 : null,
  }));
}

/**
 * Loads just one store's stable setup context after a user selects it. The
 * central store-scope check is intentionally repeated here because server
 * actions can be called without first rendering the overview page. Database
 * RLS remains the second authorization boundary for both reads.
 */
export async function loadManagementStoreDrawer(
  context: BusinessContext,
  storeId: string,
): Promise<ManagementStoreDrawerData | null> {
  if (!hasStoreAccess(context, storeId)) return null;

  const supabase = await createClient();
  const [storeResult, registersResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, code, address, phone, is_active")
      .eq("organization_id", context.organization.id)
      .eq("id", storeId)
      .maybeSingle(),
    supabase
      .from("registers")
      .select("id, name, code, is_active")
      .eq("organization_id", context.organization.id)
      .eq("store_id", storeId)
      .order("created_at", { ascending: true }),
  ]);

  const error = storeResult.error ?? registersResult.error;
  if (error) throw new Error(`Unable to load store details: ${error.message}`);
  if (!storeResult.data) return null;

  return {
    store: {
      id: storeResult.data.id,
      name: storeResult.data.name,
      code: storeResult.data.code,
      address: storeResult.data.address,
      phone: storeResult.data.phone,
      isActive: storeResult.data.is_active,
    },
    registers: (registersResult.data ?? []).map((register) => ({
      id: register.id,
      name: register.name,
      code: register.code,
      isActive: register.is_active,
    })),
  };
}

/**
 * Level 3 begins with an on-demand register identity lookup. It intentionally
 * avoids the canonical shift/cash and device/sync loaders until those drawer
 * slices are implemented. The query is scoped before it is issued and then
 * verified again against the shared store-scope rule.
 */
export async function loadManagementRegisterDrawer(
  context: BusinessContext,
  registerId: string,
): Promise<ManagementRegisterDrawerData | null> {
  const canAccessAllStores = hasOrganizationWideStoreScope(context);
  const assignedStoreIds = [...new Set(context.storeIds)];
  if (!canAccessAllStores && assignedStoreIds.length === 0) return null;

  const supabase = await createClient();
  let registerQuery = supabase
    .from("registers")
    .select("id, store_id, name, code, is_active")
    .eq("organization_id", context.organization.id)
    .eq("id", registerId);

  if (!canAccessAllStores) {
    registerQuery = registerQuery.in("store_id", assignedStoreIds);
  }

  const registerResult = await registerQuery.maybeSingle();
  if (registerResult.error) {
    throw new Error(`Unable to load register details: ${registerResult.error.message}`);
  }
  if (!registerResult.data || !hasStoreAccess(context, registerResult.data.store_id)) return null;

  const { data: store, error: storeError } = await supabase
    .from("stores")
    .select("id, name, code")
    .eq("organization_id", context.organization.id)
    .eq("id", registerResult.data.store_id)
    .maybeSingle();

  if (storeError) throw new Error(`Unable to load register store: ${storeError.message}`);
  if (!store) return null;

  return {
    register: {
      id: registerResult.data.id,
      name: registerResult.data.name,
      code: registerResult.data.code,
      isActive: registerResult.data.is_active,
    },
    store: {
      id: store.id,
      name: store.name,
      code: store.code,
    },
  };
}

type RegisterOperationalSummaryRpc = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

type RegisterOperationalSummary = {
  shift: {
    id: string;
    number: string;
    openedBy: string;
    openedAt: string;
    startingCashMinor: number;
  };
  cash: {
    cashPaymentsMinor: number | null;
    cashRefundsMinor: number | null;
    paidInMinor: number | null;
    paidOutMinor: number | null;
    expectedCashMinor: number | null;
  };
};

/**
 * Current register state is loaded only once a register is selected. Cash
 * values come from the existing authoritative shift RPC, which also preserves
 * blind-cash visibility. Device/sync records are separately capability-gated
 * and intentionally describe recorded evidence, never a guessed live state.
 */
export async function loadManagementRegisterOperationalDrawer(
  context: BusinessContext,
  registerId: string,
): Promise<ManagementRegisterOperationalDrawerData | null> {
  const register = await loadManagementRegisterDrawer(context, registerId);
  if (!register) return null;

  const canViewCurrentShift = hasPermission(context, "settings.manage")
    || hasAnyPermission(context, ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"]);
  const canViewDeviceContext = hasPermission(context, "devices.manage");
  const supabase = await createClient();

  const activeShiftQuery = canViewCurrentShift
    ? supabase
        .from("shifts")
        .select("id")
        .eq("organization_id", context.organization.id)
        .eq("register_id", register.register.id)
        .eq("status", "open")
        .maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const activeDeviceQuery = canViewDeviceContext
    ? supabase
        .from("pos_devices")
        .select("name, app_version, last_seen_at")
        .eq("organization_id", context.organization.id)
        .eq("register_id", register.register.id)
        .eq("status", "active")
        .order("last_seen_at", { ascending: false })
        .limit(1)
    : Promise.resolve({ data: [], error: null });
  const pendingSyncCountQuery = canViewDeviceContext
    ? supabase
        .from("offline_sync_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organization.id)
        .eq("register_id", register.register.id)
        .in("state", ["LOCAL_PENDING", "SYNCING"])
    : Promise.resolve({ count: null, error: null });
  const syncIssueCountQuery = canViewDeviceContext
    ? supabase
        .from("offline_sync_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", context.organization.id)
        .eq("register_id", register.register.id)
        .in("state", ["CONFLICT", "FAILED"])
    : Promise.resolve({ count: null, error: null });

  const [activeShiftResult, activeDeviceResult, pendingSyncResult, syncIssueResult] = await Promise.all([
    activeShiftQuery,
    activeDeviceQuery,
    pendingSyncCountQuery,
    syncIssueCountQuery,
  ]);
  const operationalError = [activeShiftResult, activeDeviceResult, pendingSyncResult, syncIssueResult]
    .find((result) => result.error)?.error;
  if (operationalError) {
    throw new Error(`Unable to load register operations: ${operationalError.message}`);
  }

  let currentShift: ManagementRegisterOperationalDrawerData["currentShift"] = null;
  if (activeShiftResult.data) {
    const database = supabase as unknown as RegisterOperationalSummaryRpc;
    const summaryResult = await database.rpc("get_pos_shift_operational_summary", {
      target_organization_id: context.organization.id,
      target_shift_id: activeShiftResult.data.id,
    });
    if (summaryResult.error) {
      throw new Error(`Unable to load current register shift: ${summaryResult.error.message}`);
    }
    if (!summaryResult.data || typeof summaryResult.data !== "object" || Array.isArray(summaryResult.data)) {
      throw new Error("The current register shift summary was unavailable.");
    }

    const summary = summaryResult.data as RegisterOperationalSummary;
    currentShift = {
      id: summary.shift.id,
      number: summary.shift.number,
      openedBy: summary.shift.openedBy,
      openedAt: summary.shift.openedAt,
      cash: {
        startingCashMinor: summary.shift.startingCashMinor,
        cashSalesMinor: summary.cash.cashPaymentsMinor,
        cashRefundsMinor: summary.cash.cashRefundsMinor,
        paidInMinor: summary.cash.paidInMinor,
        paidOutMinor: summary.cash.paidOutMinor,
        expectedCashMinor: summary.cash.expectedCashMinor,
      },
    };
  }

  const activeDevice = activeDeviceResult.data?.[0];
  return {
    ...register,
    canViewCurrentShift,
    currentShift,
    deviceContext: canViewDeviceContext
      ? {
          activeDevice: activeDevice
            ? {
                name: activeDevice.name,
                appVersion: activeDevice.app_version,
                lastSeenAt: activeDevice.last_seen_at,
              }
            : null,
          recordedPendingSyncCount: pendingSyncResult.count ?? 0,
          syncIssueCount: syncIssueResult.count ?? 0,
        }
      : null,
  };
}

export async function loadManagementRoles(
  context: BusinessContext,
): Promise<ManagementRolesWorkspace> {
  const supabase = await createClient();
  const [rolesResult, rolePermissionsResult, permissionsResult] = await Promise.all([
    supabase
      .from("roles")
      .select("id, name, code, description, is_system, created_at")
      .eq("organization_id", context.organization.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("role_permissions")
      .select("role_id, permission_code")
      .eq("organization_id", context.organization.id),
    supabase.from("permissions").select("code, name, category"),
  ]);

  const error = [rolesResult, rolePermissionsResult, permissionsResult].find(
    (result) => result.error,
  )?.error;

  if (error) {
    throw new Error(`Unable to load roles: ${error.message}`);
  }

  return {
    roles: rolesResult.data ?? [],
    rolePermissions: rolePermissionsResult.data ?? [],
    permissions: permissionsResult.data ?? [],
  };
}

export async function loadManagementEmployees(
  context: BusinessContext,
  options: { includeInvitations?: boolean } = {},
): Promise<ManagementEmployeesWorkspace> {
  const supabase = await createClient();
  const organizationId = context.organization.id;
  const employeeResult = await supabase
    .from("employees")
    .select("id, profile_id, employee_number, job_title, status, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (employeeResult.error) {
    throw new Error(`Unable to load employees: ${employeeResult.error.message}`);
  }

  const employeeIds = employeeResult.data.map((employee) => employee.id);
  const profileIds = employeeResult.data.map((employee) => employee.profile_id);
  const [
    profilesResult,
    roleLinksResult,
    storeLinksResult,
    rolesResult,
    storesResult,
    rolePermissionsResult,
    invitationsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", profileIds),
    supabase
      .from("employee_roles")
      .select("employee_id, role_id")
      .eq("organization_id", organizationId)
      .in("employee_id", employeeIds),
    supabase
      .from("employee_stores")
      .select("employee_id, store_id")
      .eq("organization_id", organizationId)
      .in("employee_id", employeeIds),
    supabase.from("roles").select("id, name").eq("organization_id", organizationId),
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", organizationId),
    supabase
      .from("role_permissions")
      .select("role_id, permission_code")
      .eq("organization_id", organizationId),
    options.includeInvitations
      ? supabase
          .from("employee_invitations")
          .select(
            "id, email, employee_number, job_title, role_name_snapshot, store_name_snapshot, expires_at, accepted_at, revoked_at, created_at",
          )
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = [
    profilesResult,
    roleLinksResult,
    storeLinksResult,
    rolesResult,
    storesResult,
    rolePermissionsResult,
    invitationsResult,
  ].find((result) => result.error)?.error;

  if (error) {
    throw new Error(`Unable to load employee assignments: ${error.message}`);
  }

  return {
    employees: employeeResult.data,
    profiles: profilesResult.data ?? [],
    roleLinks: roleLinksResult.data ?? [],
    storeLinks: storeLinksResult.data ?? [],
    roles: rolesResult.data ?? [],
    stores: storesResult.data ?? [],
    rolePermissions: rolePermissionsResult.data ?? [],
    invitations: invitationsResult.data ?? [],
  };
}
