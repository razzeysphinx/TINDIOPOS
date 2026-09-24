import {
  hasInventoryBackOfficeResponsibility,
} from "@/lib/auth/inventory-capabilities";

const BACK_OFFICE_PERMISSIONS =
  [
    "dashboard.view",
    "reports.view",
    "products.manage",
    "customers.manage",
    "employees.manage",
    "roles.manage",
    "stores.manage",
    "registers.manage",
    "organization.manage",
    "settings.manage",
    "approvals.manage",
    "audit.view",
    "devices.manage",
    "organization.export",
    "organization.archive",
    "organization.lifecycle",
    "recovery.view",
    "recovery.manage",
  ] as const;

/** Presentation-only navigation visibility. Server routes stay authoritative. */
export function canAccessBackOfficeV2(
  permissions: readonly string[],
  inventoryEnabled: boolean,
) {
  return BACK_OFFICE_PERMISSIONS.some(
    (permission) =>
      permissions.includes(permission),
  ) || (
    inventoryEnabled
    && hasInventoryBackOfficeResponsibility(
      permissions,
    )
  );
}
