"use client";

import { useState } from "react";
import {
  BarChart3,
  ChefHat,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  LayoutDashboard,
  MonitorSmartphone,
  MenuSquare,
  PackageSearch,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Shapes,
  Store,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

export type BackOfficeNavigationAccess = {
  canViewReceipts?: boolean;
  canViewDashboard?: boolean;
  canManageCustomers?: boolean;
  canViewReports?: boolean;
  canManageSettings?: boolean;
  canViewKitchen?: boolean;
  canUseApprovals?: boolean;
  canUseInventory?: boolean;
  canUseTimeClock?: boolean;
  canManageDevices?: boolean;
  canManageCatalog?: boolean;
  canManageEmployees?: boolean;
  canManageRoles?: boolean;
  canManageStores?: boolean;
  canManageRegisters?: boolean;
};

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  isVisible?: (access: BackOfficeNavigationAccess) => boolean;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const primaryNavigation: NavigationItem[] = [
  {
    href: "/back-office",
    label: "Dashboard",
    icon: LayoutDashboard,
    isVisible: (access) => access.canViewDashboard === true,
  },
  {
    href: "/back-office/reports",
    label: "Reports",
    icon: BarChart3,
    isVisible: (access) => access.canViewReports === true,
  },
];

const navigationGroups: NavigationGroup[] = [
  {
    label: "Sales",
    items: [
      {
        href: "/back-office/receipts",
        label: "Receipts",
        icon: ReceiptText,
        isVisible: (access) => access.canViewReceipts === true,
      },
      {
        href: "/back-office/shifts",
        label: "Shift reports",
        icon: CircleDollarSign,
        isVisible: (access) => access.canViewReports === true || access.canViewDashboard === true,
      },
      {
        href: "/kitchen",
        label: "Kitchen display",
        icon: ChefHat,
        isVisible: (access) => access.canViewKitchen === true,
      },
    ],
  },
  {
    label: "Catalog",
    items: [
      { href: "/back-office/catalog", label: "Products", icon: PackageSearch, isVisible: (access) => access.canManageCatalog === true },
      { href: "/back-office/categories", label: "Categories", icon: Shapes, isVisible: (access) => access.canManageCatalog === true },
    ],
  },
  {
    label: "Inventory",
    items: [
      {
        href: "/back-office/inventory",
        label: "Stock & inventory",
        icon: Warehouse,
        isVisible: (access) => access.canUseInventory === true,
      },
      {
        href: "/back-office/replenishment",
        label: "Replenishment",
        icon: Truck,
        isVisible: (access) => access.canUseInventory === true,
      },
    ],
  },
  {
    label: "Customers",
    items: [
      {
        href: "/back-office/customers",
        label: "Customer list & loyalty",
        icon: Users,
        isVisible: (access) => access.canManageCustomers === true,
      },
    ],
  },
  {
    label: "Team",
    items: [
      { href: "/back-office/employees", label: "Employees", icon: Users, isVisible: (access) => access.canManageEmployees === true },
      { href: "/back-office/roles", label: "Roles & access", icon: ShieldCheck, isVisible: (access) => access.canManageRoles === true },
      {
        href: "/back-office/time-clock",
        label: "Time clock",
        icon: Clock3,
        isVisible: (access) => access.canUseTimeClock === true,
      },
      {
        href: "/back-office/security",
        label: "Security & approvals",
        icon: ShieldCheck,
        isVisible: (access) => access.canUseApprovals === true,
      },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/back-office/stores", label: "Stores", icon: Store, isVisible: (access) => access.canManageStores === true },
      { href: "/back-office/registers", label: "Registers", icon: MonitorSmartphone, isVisible: (access) => access.canManageRegisters === true },
      {
        href: "/back-office/devices",
        label: "POS devices",
        icon: MonitorSmartphone,
        isVisible: (access) => access.canManageDevices === true,
      },
      {
        href: "/back-office/offline-sync",
        label: "Offline sync",
        icon: CloudUpload,
        isVisible: (access) => access.canManageDevices === true,
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        href: "/back-office/business-profile",
        label: "Business profile",
        icon: Settings2,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/payment-methods",
        label: "Payment methods",
        icon: Settings2,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/receipt-settings",
        label: "Receipt settings",
        icon: ReceiptText,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/advanced-sales",
        label: "Advanced sales",
        icon: Settings2,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/smart-menu",
        label: "Smart Menu",
        icon: MenuSquare,
        isVisible: (access) => access.canManageSettings === true,
      },
    ],
  },
];

function isCurrentRoute(pathname: string, href: string) {
  return href === "/back-office"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

function NavigationLink({ href, icon: Icon, label, active }: NavigationItem & { active: boolean }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      href={href}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  );
}

function NavigationGroupSection({
  group,
  pathname,
}: {
  group: NavigationGroup;
  pathname: string;
}) {
  const hasActiveItem = group.items.some((item) => isCurrentRoute(pathname, item.href));
  const [isOpen, setIsOpen] = useState(hasActiveItem);

  return (
    <details
      className="group rounded-lg"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        {group.label}
        <ChevronDown
          className="size-4 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div className="mt-1 grid gap-1 border-l border-border pl-2">
        {group.items.map((item) => (
          <NavigationLink
            {...item}
            active={isCurrentRoute(pathname, item.href)}
            key={item.href}
          />
        ))}
      </div>
    </details>
  );
}

export function BackOfficeNavigation({
  mobile = false,
  ...access
}: BackOfficeNavigationAccess & { mobile?: boolean }) {
  const pathname = usePathname();
  const visiblePrimaryNavigation = primaryNavigation.filter(
    (item) => !item.isVisible || item.isVisible(access),
  );
  const visibleNavigationGroups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.isVisible || item.isVisible(access)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label="Back Office"
      className={cn(
        mobile
          ? "max-h-[min(28rem,calc(100svh-4rem))] overflow-y-auto border-t border-border bg-background px-4 py-3"
          : "min-h-0 flex-1 overflow-y-auto px-3 py-5",
      )}
    >
      <div className="grid gap-1">
        {visiblePrimaryNavigation.map((item) => (
          <NavigationLink
            {...item}
            active={isCurrentRoute(pathname, item.href)}
            key={item.href}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-2">
        {visibleNavigationGroups.map((group) => (
          <NavigationGroupSection
            group={group}
            key={`${pathname}:${group.label}`}
            pathname={pathname}
          />
        ))}
      </div>
    </nav>
  );
}
