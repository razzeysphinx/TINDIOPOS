import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";

import { BackOfficeNavigation } from "@/components/back-office/back-office-navigation";
import { TindioMark } from "@/components/brand/tindio-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { OrganizationSwitcher } from "@/features/organization-readiness/organization-switcher";
import { requireBackOfficeContext } from "@/lib/auth/dal";

export default async function BackOfficeLayout({ children }: { children: ReactNode }) {
  await connection();
  const context = await requireBackOfficeContext();
  const displayName = context.profile.full_name || context.profile.email;
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
    <div className="min-h-svh bg-muted/35 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-card print:hidden lg:sticky lg:top-0 lg:flex lg:h-svh lg:self-start lg:flex-col">
        <Link className="border-b border-border px-5 py-5" href="/back-office">
          <TindioMark />
        </Link>
        <BackOfficeNavigation {...navigationAccess} />
        <div className="mt-auto border-t border-border p-4">
          <p className="truncate text-sm font-semibold">{displayName}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {context.employee.employee_number}
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur print:hidden">
          <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <Link className="lg:hidden" href="/back-office">
              <TindioMark />
            </Link>
            <div className="hidden min-w-0 lg:block">
              <p className="truncate text-sm font-semibold">{context.organization.name}</p>
              <p className="text-xs text-muted-foreground">
                {context.roleNames.join(", ") || "No assigned role"}
              </p>
            </div>
            <div className="flex items-center gap-2">
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
            <BackOfficeNavigation {...navigationAccess} mobile />
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl px-4 py-7 print:max-w-none print:px-0 print:py-0 sm:px-6 sm:py-9 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
