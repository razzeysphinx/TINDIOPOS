import "server-only";

import type { ManagementDisplaySessionRow, ManagementEmployeeDetail, ManagementEmployeesWorkspace, ManagementRegisterDrawerData, ManagementRegisterOperationalDrawerData, ManagementRegistersWorkspace, ManagementRolesWorkspace, ManagementStoreDrawerData, ManagementStoreRegisterOverviewRow, ManagementStoreRow } from "@/features/management/management-types";
import { loadManagementReadBundleResult, type ManagementReadNeed } from "@/features/management/management-read-model";
import { hasAnyPermission, hasOrganizationWideStoreScope, hasPermission, hasStoreAccess, type BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

async function managementBundle(context: BusinessContext, needs: readonly ManagementReadNeed[]) {
  const client = await createClient();
  const result = await loadManagementReadBundleResult({ client, organizationId: context.organization.id, needs });
  if (result.error) throw new Error(`Unable to load management data: ${result.error.message}`);
  return { client, data: result.data };
}

export async function loadManagementStores(context: BusinessContext): Promise<ManagementStoreRow[]> {
  const { data } = await managementBundle(context, ["stores"]);
  return data.stores as ManagementStoreRow[];
}

export async function loadManagementRegisters(context: BusinessContext, options: { includeDisplaySessions?: boolean } = {}): Promise<ManagementRegistersWorkspace> {
  const { client, data } = await managementBundle(context, ["stores", "registers"]);
  const display = options.includeDisplaySessions ? await client.rpc("get_customer_display_management_sessions", { target_organization_id: context.organization.id }) : { data: [] as ManagementDisplaySessionRow[], error: null };
  if (display.error) throw new Error(`Unable to load registers: ${display.error.message}`);
  return { registers: data.registers as ManagementRegistersWorkspace["registers"], stores: data.stores.map(({ id, name, is_active }) => ({ id, name, is_active })), displaySessions: display.data ?? [] };
}

export async function loadManagementStoreRegisterOverview(context: BusinessContext): Promise<ManagementStoreRegisterOverviewRow[]> {
  const allStores = hasOrganizationWideStoreScope(context);
  const assigned = new Set(context.storeIds);
  if (!allStores && assigned.size === 0) return [];
  const canShifts = hasPermission(context, "settings.manage") || hasAnyPermission(context, ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"]);
  const canDevices = hasPermission(context, "devices.manage");
  const { data } = await managementBundle(context, ["stores", "registers", ...(canShifts ? ["shifts" as const] : []), ...(canDevices ? ["posDevices" as const, "offlineSyncEvents" as const] : [])]);
  const visible = data.stores.filter((store) => allStores || assigned.has(store.id));
  const count = (rows: Array<{ store_id: string }>) => rows.reduce((map, row) => map.set(row.store_id, (map.get(row.store_id) ?? 0) + 1), new Map<string, number>());
  const registerCounts = count(data.registers.filter((row) => allStores || assigned.has(row.store_id)));
  const shiftCounts = count(data.shifts.filter((row) => row.status === "open" && (allStores || assigned.has(row.store_id))));
  const deviceCounts = count(data.posDevices.filter((row) => row.status === "active" && (allStores || assigned.has(row.store_id))));
  const syncCounts = count(data.offlineSyncEvents.filter((row) => ["CONFLICT", "FAILED"].includes(row.state) && (allStores || assigned.has(row.store_id))));
  return visible.map((store) => ({ id: store.id, name: store.name, code: store.code, address: store.address, phone: store.phone, isActive: store.is_active, registerCount: registerCounts.get(store.id) ?? 0, openShiftCount: canShifts ? shiftCounts.get(store.id) ?? 0 : null, activeDeviceCount: canDevices ? deviceCounts.get(store.id) ?? 0 : null, syncIssueCount: canDevices ? syncCounts.get(store.id) ?? 0 : null }));
}

export async function loadManagementStoreDrawer(context: BusinessContext, storeId: string): Promise<ManagementStoreDrawerData | null> {
  if (!hasStoreAccess(context, storeId)) return null;
  const { data } = await managementBundle(context, ["stores", "registers"]);
  const store = data.stores.find((row) => row.id === storeId);
  if (!store) return null;
  return { store: { id: store.id, name: store.name, code: store.code, address: store.address, phone: store.phone, isActive: store.is_active }, registers: data.registers.filter((row) => row.store_id === storeId).map((row) => ({ id: row.id, name: row.name, code: row.code, isActive: row.is_active })) };
}

export async function loadManagementRegisterDrawer(context: BusinessContext, registerId: string): Promise<ManagementRegisterDrawerData | null> {
  const allStores = hasOrganizationWideStoreScope(context);
  if (!allStores && context.storeIds.length === 0) return null;
  const { data } = await managementBundle(context, ["stores", "registers"]);
  const register = data.registers.find((row) => row.id === registerId && (allStores || hasStoreAccess(context, row.store_id)));
  if (!register) return null;
  const store = data.stores.find((row) => row.id === register.store_id);
  if (!store) return null;
  return { register: { id: register.id, name: register.name, code: register.code, isActive: register.is_active }, store: { id: store.id, name: store.name, code: store.code } };
}

type RegisterOperationalSummary = { shift: { id: string; number: string; openedBy: string; openedAt: string; startingCashMinor: number }; cash: { cashPaymentsMinor: number | null; cashRefundsMinor: number | null; paidInMinor: number | null; paidOutMinor: number | null; expectedCashMinor: number | null } };

export async function loadManagementRegisterOperationalDrawer(context: BusinessContext, registerId: string): Promise<ManagementRegisterOperationalDrawerData | null> {
  const register = await loadManagementRegisterDrawer(context, registerId);
  if (!register) return null;
  const canShift = hasPermission(context, "settings.manage") || hasAnyPermission(context, ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out"]);
  const canDevice = hasPermission(context, "devices.manage");
  const { client, data } = await managementBundle(context, ["shifts", "posDevices", "offlineSyncEvents"]);
  const shift = canShift ? data.shifts.find((row) => row.register_id === registerId && row.status === "open") : undefined;
  let currentShift: ManagementRegisterOperationalDrawerData["currentShift"] = null;
  if (shift) {
    const result = await client.rpc("get_pos_shift_operational_summary", { target_organization_id: context.organization.id, target_shift_id: shift.id });
    if (result.error) throw new Error(`Unable to load current register shift: ${result.error.message}`);
    const summary = result.data as unknown as RegisterOperationalSummary | null;
    if (summary) currentShift = { id: summary.shift.id, number: summary.shift.number, openedBy: summary.shift.openedBy, openedAt: summary.shift.openedAt, cash: { startingCashMinor: summary.shift.startingCashMinor, cashSalesMinor: summary.cash.cashPaymentsMinor, cashRefundsMinor: summary.cash.cashRefundsMinor, paidInMinor: summary.cash.paidInMinor, paidOutMinor: summary.cash.paidOutMinor, expectedCashMinor: summary.cash.expectedCashMinor } };
  }
  const active = data.posDevices.find((row) => row.register_id === registerId && row.status === "active") ?? null;
  const count = (states: string[]) => data.offlineSyncEvents.filter((row) => row.register_id === registerId && states.includes(row.state)).length;
  return { ...register, canViewCurrentShift: canShift, currentShift, deviceContext: canDevice ? { activeDevice: active ? { name: active.name, appVersion: active.app_version, lastSeenAt: active.last_seen_at } : null, recordedPendingSyncCount: count(["LOCAL_PENDING", "SYNCING"]), syncIssueCount: count(["CONFLICT", "FAILED"]) } : null };
}

export async function loadManagementRoles(context: BusinessContext): Promise<ManagementRolesWorkspace> {
  const { data } = await managementBundle(context, ["roles", "rolePermissions", "permissions"]);
  return { roles: data.roles as ManagementRolesWorkspace["roles"], rolePermissions: data.rolePermissions, permissions: data.permissions };
}

export async function loadManagementEmployees(context: BusinessContext, options: { includeInvitations?: boolean } = {}): Promise<ManagementEmployeesWorkspace> {
  const { data } = await managementBundle(context, ["employees", "profiles", "employeeRoles", "employeeStores", "roles", "stores", "rolePermissions", ...(options.includeInvitations ? ["employeeInvitations" as const] : [])]);
  return { employees: data.employees as ManagementEmployeesWorkspace["employees"], profiles: data.profiles, roleLinks: data.employeeRoles, storeLinks: data.employeeStores, roles: data.roles.map(({ id, name }) => ({ id, name })), stores: data.stores.map(({ id, name, is_active }) => ({ id, name, is_active })), rolePermissions: data.rolePermissions, invitations: data.employeeInvitations };
}

export async function loadManagementEmployeeDetail(context: BusinessContext, employeeId: string): Promise<ManagementEmployeeDetail | null> {
  const client = await createClient();
  const { data, error } = await client.rpc("get_employee_management_detail", { target_organization_id: context.organization.id, target_employee_id: employeeId });
  if (error) throw new Error(`Unable to load employee details: ${error.message}`);
  return data ? data as unknown as ManagementEmployeeDetail : null;
}
