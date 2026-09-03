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
  // CANDIDATE_FOR_REMOVAL: the Owner Dashboard now uses compact, low-priority
  // quick actions. Keep this branch until every external reference is verified;
  // the inventory surface below is still an active dependency.
  const actions: DashboardAction[] = [];

  if (hasPermission(permissions, "reports.view")) {
    actions.push({
      title: "See how your business is doing",
      description: "Review sales, payments, and business trends.",
      href: "/back-office/reports",
      icon: BookOpenCheck,
    });
  }

  if (hasPermission(permissions, "inventory.manage") && inventoryEnabled) {
    actions.push({
      title: "Check your stock",
      description: "See stock levels, restocking work, and recent changes.",
      href: "/back-office/inventory",
      icon: Boxes,
    });
  }

  if (hasPermission(permissions, "products.manage")) {
    actions.push({
      title: "Manage your products",
      description: "Add products, prices, categories, and selling options.",
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
      title: "Manage your team",
      description: "Invite employees and choose what they can access.",
      href: hasPermission(permissions, "employees.manage")
        ? "/back-office/employees"
        : "/back-office/roles",
      icon: UsersRound,
    });
  }

  if (hasAnyPermission(permissions, ["approvals.manage", "audit.view"])) {
    actions.push({
      title: "Review approvals & security",
      description: "Review sensitive actions and approval activity.",
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
        ? "Manage stores & operations"
        : "Manage your operations",
      description: hasPermission(permissions, "stores.manage")
        ? "Set up stores, registers, and operational tools."
        : "Review the business settings available to you.",
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
      title: "Your stock overview",
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
      title: "Stock activity",
      description: "See what changed and why it changed.",
      href: "/back-office/inventory?tab=activity",
      icon: ClipboardList,
    },
    {
      title: "Count your stock",
      description: "Compare what you physically have with TINDIO’s record.",
      href: "/back-office/inventory?tab=counts",
      icon: ClipboardList,
    },
    {
      title: "Buy and receive stock",
      description: "Manage suppliers, purchase orders, and deliveries.",
      href: "/back-office/inventory?tab=purchasing",
      icon: PackageSearch,
    },
    {
      title: "Move stock between stores",
      description: "Send stock and record when the destination receives it.",
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
          {inventory ? "What do you need to do?" : "What would you like to do?"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {inventory
            ? "Start with the simple view, then open an operation only when you need it."
            : organizationWide
              ? "Choose the area you want to manage next."
              : "These actions and figures are limited to your assigned stores."}
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
