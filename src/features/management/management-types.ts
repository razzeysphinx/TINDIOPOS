export type ManagementActionResult<T = undefined> =
  | { ok: true; message: string; data?: T }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type ManagementStoreRow = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
};

export type ManagementRegisterRow = {
  id: string;
  store_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
};

export type ManagementStoreOptionRow = {
  id: string;
  name: string;
  is_active: boolean;
};

export type ManagementDisplaySessionRow = {
  register_id: string;
  created_at: string;
  last_published_at: string | null;
};

export type ManagementRegistersWorkspace = {
  registers: ManagementRegisterRow[];
  stores: ManagementStoreOptionRow[];
  displaySessions: ManagementDisplaySessionRow[];
};

export type ManagementRoleRow = {
  id: string;
  name: string;
  code: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
};

export type ManagementRolePermissionRow = {
  role_id: string;
  permission_code: string;
};

export type ManagementPermissionRow = {
  code: string;
  name: string;
  category: string;
};

export type ManagementRolesWorkspace = {
  roles: ManagementRoleRow[];
  rolePermissions: ManagementRolePermissionRow[];
  permissions: ManagementPermissionRow[];
};

export type ManagementEmployeeRow = {
  id: string;
  profile_id: string;
  employee_number: string;
  job_title: string | null;
  status: string;
  created_at: string;
};

export type ManagementProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

export type ManagementRoleOptionRow = {
  id: string;
  name: string;
};

export type ManagementInvitationRow = {
  id: string;
  email: string;
  employee_number: string;
  job_title: string | null;
  role_name_snapshot: string;
  store_name_snapshot: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ManagementEmployeesWorkspace = {
  employees: ManagementEmployeeRow[];
  profiles: ManagementProfileRow[];
  roleLinks: Array<{ employee_id: string; role_id: string }>;
  storeLinks: Array<{ employee_id: string; store_id: string }>;
  roles: ManagementRoleOptionRow[];
  stores: ManagementStoreOptionRow[];
  rolePermissions: ManagementRolePermissionRow[];
  invitations: ManagementInvitationRow[];
};
