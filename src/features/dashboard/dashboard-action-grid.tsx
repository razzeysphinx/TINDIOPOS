import type { LucideIcon } from "lucide-react";
import {
  BookOpenCheck,
  Boxes,
  ClipboardList,
  FolderCog,
  PackageSearch,
  ShieldCheck,
  SlidersHorizontal,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
type DashboardSurface = "business" | "inventory";

type DashboardAction = {
  description: string;
  href: string;
  icon: LucideIcon;
  title: string;
};

function hasPermission(permissions: readonly string[], permission: string) {
  return permissions.includes(permission);
}

function hasAnyPermission(permissions: readonly string[], requiredPermissions: readonly string[]) {
  return requiredPermissions.some((permission) => hasPermission(permissions, permission));
}

function getBusinessActions(
  permissions: readonly string[],
  inventoryEnabled: boolean,
): DashboardAction[] {
  const actions: DashboardAction[] = [];

  if (hasPermission(permissions, "reports.view")) {
    actions.push({
      title: "Business reports",
      description: "Review sales, payment, and operational trends.",
      href: "/back-office/reports",
      icon: BookOpenCheck,
    });
  }

  if (hasPermission(permissions, "inventory.manage") && inventoryEnabled) {
    actions.push({
      title: "Stock operations",
      description: "Review stock levels, adjustments, and purchasing work.",
      href: "/back-office/inventory",
      icon: Boxes,
    });
  }

  if (hasPermission(permissions, "products.manage")) {
    actions.push({
      title: "Catalog",
      description: "Maintain products, prices, and store availability.",
      href: "/back-office/catalog",
      icon: PackageSearch,
    });
  }

  if (hasPermission(permissions, "customers.manage")) {
    actions.push({
      title: "Customers",
      description: "Manage customer profiles and store relationships.",
      href: "/back-office/customers",
      icon: UsersRound,
    });
  }

  if (hasAnyPermission(permissions, ["employees.manage", "roles.manage"])) {
    actions.push({
      title: "Team access",
      description: "Manage employee assignments and role access.",
      href: hasPermission(permissions, "employees.manage")
        ? "/back-office/employees"
        : "/back-office/roles",
      icon: UsersRound,
    });
  }

  if (hasAnyPermission(permissions, ["approvals.manage", "audit.view"])) {
    actions.push({
      title: "Security controls",
      description: "Review approvals and recorded security activity.",
      href: "/back-office/security",
      icon: ShieldCheck,
    });
  }

  if (hasAnyPermission(permissions, [
    "settings.manage",
    "organization.manage",
    "stores.manage",
    "registers.manage",
    "devices.manage",
  ])) {
    actions.push({
      title: hasPermission(permissions, "stores.manage")
        ? "Organization controls"
        : "Operational settings",
      description: hasPermission(permissions, "stores.manage")
        ? "Manage store-level business operations and configuration."
        : "Review the operational settings available to you.",
      href: hasPermission(permissions, "stores.manage")
        ? "/back-office/stores"
        : hasPermission(permissions, "registers.manage")
          ? "/back-office/registers"
          : hasPermission(permissions, "devices.manage")
            ? "/back-office/devices"
            : "/back-office/business-profile",
      icon: FolderCog,
    });
  }

  return actions;
}

function getInventoryActions(): DashboardAction[] {
  return [
    {
      title: "Overview",
      description: "Review inventory health and the work needing attention.",
      href: "/back-office/inventory?tab=overview",
      icon: Boxes,
    },
    {
      title: "Stock",
      description: "Check current store-level balances.",
      href: "/back-office/inventory?tab=stock",
      icon: PackageSearch,
    },
    {
      title: "Activity",
      description: "Review the latest accountable stock changes.",
      href: "/back-office/inventory?tab=activity",
      icon: ClipboardList,
    },
    {
      title: "Counts",
      description: "Record and reconcile physical stock counts.",
      href: "/back-office/inventory?tab=counts",
      icon: ClipboardList,
    },
    {
      title: "Purchasing",
      description: "Manage suppliers, orders, and receiving.",
      href: "/back-office/inventory?tab=purchasing",
      icon: PackageSearch,
    },
    {
      title: "Transfers",
      description: "Send stock between stores and receive it safely.",
      href: "/back-office/inventory?tab=transfers",
      icon: SlidersHorizontal,
    },
  ];
}

export function DashboardActionGrid({
  inventoryEnabled,
  permissions,
  surface,
}: {
  inventoryEnabled: boolean;
  permissions: readonly string[];
  surface: DashboardSurface;
}) {
  const organizationWide = hasPermission(permissions, "stores.manage");
  const actions = surface === "inventory"
    ? getInventoryActions()
    : getBusinessActions(permissions, inventoryEnabled);

  if (actions.length === 0) {
    return null;
  }

  const inventory = surface === "inventory";

  return (
    <section aria-labelledby={`${surface}-actions-heading`} className="space-y-3">
      <div>
        <h2 className="font-heading text-lg font-semibold" id={`${surface}-actions-heading`}>
          {inventory ? "Inventory operations" : "Your available actions"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {inventory
            ? "Use the existing inventory workflows appropriate to your access."
            : organizationWide
              ? "Organization-wide actions are shown only where your permissions allow them."
              : "Actions and reporting remain limited to your assigned store access."}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => {
          const Icon = action.icon;

          return (
            <Link className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={action.href} key={action.href}>
              <Card className="h-full transition-colors group-hover:bg-muted/50">
                <CardHeader>
                  <Icon aria-hidden="true" className="size-5 text-primary" />
                  <CardTitle className="mt-2">{action.title}</CardTitle>
                  <CardDescription>{action.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
