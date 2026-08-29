import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import {
  BackOfficeHeaderControls,
  BackOfficeMobileNavigation,
  BackOfficeWorkspaceShell,
} from "@/components/back-office/back-office-workspace-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { OrganizationSwitcher } from "@/features/organization-readiness/organization-switcher";
import { requireBackOfficeContext } from "@/lib/auth/dal";

export default async function BackOfficeLayout({ children }: { children: ReactNode }) {
  await connection();
  const context = await requireBackOfficeContext();
  const displayName = context.profile.full_name || context.profile.email;
  const canUsePos = context.permissions.includes("pos.access");
  const navigationAccess = {
    canManageSettings: context.permissions.includes("settings.manage"),
    canManageCustomers: context.permissions.includes("customers.manage"),
    canViewReceipts: context.permissions.includes("receipts.view"),
    canViewReports: context.permissions.includes("reports.view"),
    canViewDashboard: context.permissions.includes("dashboard.view"),
    canViewKitchen: context.features.kitchen_display && context.permissions.some((permission) => ["kitchen.view", "kitchen.manage"].includes(permission)),
    canUseApprovals: context.permissions.some((permission) => ["approvals.manage", "audit.view"].includes(permission)),
    canUseInventory: context.features.inventory && context.permissions.includes("inventory.manage"),
    canManageCatalog: context.permissions.includes("products.manage"),
    canManageAdvancedSales: context.permissions.includes("products.manage"),
    canManageEmployees: context.permissions.includes("employees.manage"),
    canManageRoles: context.permissions.includes("roles.manage"),
    canManageStores: context.permissions.includes("stores.manage"),
    canManageRegisters: context.permissions.includes("registers.manage"),
    canUseTimeClock: context.features.time_clock && context.permissions.includes("dashboard.view"),
    canManageDevices: context.permissions.includes("devices.manage"),
  };

  return (
    <BackOfficeWorkspaceShell
      displayName={displayName}
      employeeNumber={context.employee.employee_number}
      header={(
        <header className="fixed inset-x-0 top-0 z-20 border-b border-border bg-background/95 backdrop-blur print:hidden">
          <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
            <BackOfficeHeaderControls />
            <div className="flex shrink-0 items-center gap-2">
              {canUsePos ? (
                <Button nativeButton={false} render={<Link href="/pos" />} size="sm" variant="outline">
                  Open POS
                </Button>
              ) : null}
              <OrganizationSwitcher
                organizations={context.availableOrganizations}
                selectedOrganizationId={context.organization.id}
              />
              <Badge variant="secondary" className="hidden sm:inline-flex">
                {context.organization.currency_code}
              </Badge>
              <form action={signOutAction}>
                <Button size="sm" type="submit" variant="ghost">
                  <LogOut aria-hidden="true" />
                  Sign out
                </Button>
              </form>
            </div>
          </div>
          <div className="lg:hidden">
            <BackOfficeMobileNavigation navigationAccess={navigationAccess} />
          </div>
        </header>
      )}
      navigationAccess={navigationAccess}
    >
      <main className="mx-auto w-full max-w-7xl px-4 py-6 print:max-w-none print:px-0 print:py-0 sm:px-6 sm:py-8 lg:px-8">
        {children}
      </main>
    </BackOfficeWorkspaceShell>
  );
}
