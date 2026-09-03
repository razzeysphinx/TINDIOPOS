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

export type ManagementStoreRegisterOverviewRow = {
  id: string;
  name: string;
  code: string;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  registerCount: number;
  openShiftCount: number | null;
  activeDeviceCount: number | null;
  syncIssueCount: number | null;
};

/**
 * Deliberately small, on-demand payload for the Stores & Registers drawer.
 * Shift, cash, and device diagnostics are loaded by their later operational
 * drawers instead of being bundled into every store selection.
 */
export type ManagementStoreDrawerData = {
  store: {
    id: string;
    name: string;
    code: string;
    address: string | null;
    phone: string | null;
    isActive: boolean;
  };
  registers: Array<{
    id: string;
    name: string;
    code: string;
    isActive: boolean;
  }>;
};

/**
 * Level 3 register identity and configuration context. Operational shift,
 * cash, device, and sync state deliberately belong to later drawer slices.
 */
export type ManagementRegisterDrawerData = {
  register: {
    id: string;
    name: string;
    code: string;
    isActive: boolean;
  };
  store: {
    id: string;
    name: string;
    code: string;
  };
};

export type ManagementRegisterOperationalDrawerData = ManagementRegisterDrawerData & {
  /** False means the role is not allowed to inspect a current register shift. */
  canViewCurrentShift: boolean;
  currentShift: {
    id: string;
    number: string;
    openedBy: string;
    openedAt: string;
    cash: {
      startingCashMinor: number | null;
      cashSalesMinor: number | null;
      cashRefundsMinor: number | null;
      paidInMinor: number | null;
      paidOutMinor: number | null;
      expectedCashMinor: number | null;
    };
  } | null;
  /** Device/sync evidence is available only to device managers. */
  deviceContext: {
    activeDevice: {
      name: string;
      appVersion: string;
      lastSeenAt: string | null;
    } | null;
    recordedPendingSyncCount: number;
    syncIssueCount: number;
  } | null;
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

export type ManagementEmployeeDetail = {
  id: string;
  employeeNumber: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  status: "active" | "inactive" | "suspended" | "archived";
  archivedAt: string | null;
  pinIsSet: boolean;
  roles: Array<{ id: string; name: string }>;
  stores: Array<{ id: string; name: string }>;
  posAccess: boolean;
  backOfficeAccess: boolean;
  attendance: {
    current: { id: string; storeId: string; storeName?: string; clockedInAt: string } | null;
    lastClockIn: string | null;
    historyCount: number;
    history: Array<{ id: string; storeName: string; clockedInAt: string; clockedOutAt: string | null }>;
  };
  activity: { receipts: number; registerShifts: number; refunds: number; inventoryMovements: number };
  openShift: { id: string; storeId: string; storeName: string; registerId: string; registerName: string; openedAt: string } | null;
  deleteBlockers: string[];
};
