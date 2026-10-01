import "server-only";

import type { TableRow } from "@/lib/supabase/database.types";

type ReadError = { code?: string; details?: string; hint?: string; message: string };
type RpcResult = { data: unknown; error: ReadError | null };
type Store = Pick<TableRow<"stores">, "id" | "name" | "code" | "address" | "phone" | "is_active" | "created_at">;
type Register = Pick<TableRow<"registers">, "id" | "store_id" | "name" | "code" | "is_active" | "created_at">;
type Shift = Pick<TableRow<"shifts">, "id" | "store_id" | "register_id" | "status" | "opened_at">;
type Device = Pick<TableRow<"pos_devices">, "id" | "store_id" | "register_id" | "name" | "app_version" | "last_seen_at" | "status">;
type SyncEvent = Pick<TableRow<"offline_sync_events">, "id" | "store_id" | "register_id" | "state">;
type Role = Pick<TableRow<"roles">, "id" | "name" | "code" | "description" | "is_system" | "created_at">;
type RolePermission = Pick<TableRow<"role_permissions">, "role_id" | "permission_code">;
type Permission = Pick<TableRow<"permissions">, "code" | "name" | "category">;
type Employee = Pick<TableRow<"employees">, "id" | "profile_id" | "employee_number" | "job_title" | "status" | "created_at">;
type Profile = Pick<TableRow<"profiles">, "id" | "full_name" | "email">;
type EmployeeRole = Pick<TableRow<"employee_roles">, "employee_id" | "role_id">;
type EmployeeStore = Pick<TableRow<"employee_stores">, "employee_id" | "store_id">;
type EmployeeInvitation = Pick<TableRow<"employee_invitations">, "id" | "email" | "employee_number" | "job_title" | "role_name_snapshot" | "store_name_snapshot" | "expires_at" | "accepted_at" | "revoked_at" | "created_at">;

export type ManagementReadNeed = "stores" | "registers" | "shifts" | "posDevices" | "offlineSyncEvents" | "roles" | "rolePermissions" | "permissions" | "employees" | "profiles" | "employeeRoles" | "employeeStores" | "employeeInvitations";
export type ManagementReadBundle = { stores: Store[]; registers: Register[]; shifts: Shift[]; posDevices: Device[]; offlineSyncEvents: SyncEvent[]; roles: Role[]; rolePermissions: RolePermission[]; permissions: Permission[]; employees: Employee[]; profiles: Profile[]; employeeRoles: EmployeeRole[]; employeeStores: EmployeeStore[]; employeeInvitations: EmployeeInvitation[] };
const recordOf = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const rows = <T,>(record: Record<string, unknown>, key: string) => Array.isArray(record[key]) ? record[key] as T[] : [];

export async function loadManagementReadBundleResult({ client, organizationId, needs }: { client: unknown; organizationId: string; needs: readonly ManagementReadNeed[] }): Promise<{ data: ManagementReadBundle; error: ReadError | null }> {
  const result = await (client as { rpc(name: "get_management_workspace_bundle_v1", args: { target_organization_id: string; requested_needs: readonly ManagementReadNeed[] }): PromiseLike<RpcResult> }).rpc("get_management_workspace_bundle_v1", { target_organization_id: organizationId, requested_needs: needs });
  const record = recordOf(result.data);
  return { data: { stores: rows<Store>(record, "stores"), registers: rows<Register>(record, "registers"), shifts: rows<Shift>(record, "shifts"), posDevices: rows<Device>(record, "posDevices"), offlineSyncEvents: rows<SyncEvent>(record, "offlineSyncEvents"), roles: rows<Role>(record, "roles"), rolePermissions: rows<RolePermission>(record, "rolePermissions"), permissions: rows<Permission>(record, "permissions"), employees: rows<Employee>(record, "employees"), profiles: rows<Profile>(record, "profiles"), employeeRoles: rows<EmployeeRole>(record, "employeeRoles"), employeeStores: rows<EmployeeStore>(record, "employeeStores"), employeeInvitations: rows<EmployeeInvitation>(record, "employeeInvitations") }, error: result.error };
}
