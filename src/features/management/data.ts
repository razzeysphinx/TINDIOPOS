import "server-only";

import type {
  ManagementDisplaySessionRow,
  ManagementEmployeesWorkspace,
  ManagementRegistersWorkspace,
  ManagementRolesWorkspace,
  ManagementStoreRow,
} from "@/features/management/management-types";
import type { BusinessContext } from "@/lib/auth/dal";
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
