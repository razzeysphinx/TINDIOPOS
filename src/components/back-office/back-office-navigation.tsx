"use client";

import {
  BarChart3,
  ChefHat,
  LayoutDashboard,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  MonitorSmartphone,
  PackageSearch,
  ReceiptText,
  ShoppingCart,
  Shapes,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navigation: Array<{
  href: string;
  label: string;
  icon: LucideIcon;
  requiresSalesAccess?: boolean;
  requiresReceiptAccess?: boolean;
  requiresShiftAccess?: boolean;
  requiresCustomerAccess?: boolean;
  requiresReportsAccess?: boolean;
  requiresSettingsAccess?: boolean;
  requiresKitchenAccess?: boolean;
  requiresApprovalAccess?: boolean;
  requiresInventoryAccess?: boolean;
  requiresTimeClockAccess?: boolean;
  requiresDeviceAccess?: boolean;
}> = [
  { href: "/back-office", label: "Dashboard", icon: LayoutDashboard },
  {
    href: "/back-office/reports",
    label: "Reports",
    icon: BarChart3,
    requiresReportsAccess: true,
  },
  {
    href: "/pos",
    label: "Open POS",
    icon: ShoppingCart,
    requiresSalesAccess: true,
  },
  {
    href: "/back-office/customers",
    label: "Customers",
    icon: Users,
    requiresCustomerAccess: true,
  },
  {
    href: "/back-office/receipts",
    label: "Receipts",
    icon: ReceiptText,
    requiresReceiptAccess: true,
  },
  {
    href: "/back-office/receipt-settings",
    label: "Receipt settings",
    icon: ReceiptText,
    requiresSettingsAccess: true,
  },
  {
    href: "/back-office/shifts",
    label: "Register shifts",
    icon: CircleDollarSign,
    requiresShiftAccess: true,
  },
  {
    href: "/back-office/time-clock",
    label: "Time clock",
    icon: Clock3,
    requiresTimeClockAccess: true,
  },
  {
    href: "/kitchen",
    label: "Kitchen display",
    icon: ChefHat,
    requiresKitchenAccess: true,
  },
  { href: "/back-office/stores", label: "Stores", icon: Store },
  {
    href: "/back-office/registers",
    label: "Registers",
    icon: MonitorSmartphone,
  },
  {
    href: "/back-office/devices",
    label: "POS devices",
    icon: MonitorSmartphone,
    requiresDeviceAccess: true,
  },
  {
    href: "/back-office/offline-sync",
    label: "Offline sync",
    icon: CloudUpload,
    requiresDeviceAccess: true,
  },
  { href: "/back-office/employees", label: "Employees", icon: Users },
  { href: "/back-office/roles", label: "Roles & access", icon: ShieldCheck },
  {
    href: "/back-office/security",
    label: "Security & approvals",
    icon: ShieldCheck,
    requiresApprovalAccess: true,
  },
  { href: "/back-office/categories", label: "Categories", icon: Shapes },
  { href: "/back-office/catalog", label: "Catalog", icon: PackageSearch },
  {
    href: "/back-office/inventory",
    label: "Inventory",
    icon: Warehouse,
    requiresInventoryAccess: true,
  },
  {
    href: "/back-office/replenishment",
    label: "Replenishment",
    icon: Truck,
    requiresInventoryAccess: true,
  },
  {
    href: "/back-office/payment-methods",
    label: "Payment methods",
    icon: SlidersHorizontal,
    requiresSettingsAccess: true,
  },
  {
    href: "/back-office/business-profile",
    label: "Business profile",
    icon: SlidersHorizontal,
    requiresSettingsAccess: true,
  },
  {
    href: "/back-office/advanced-sales",
    label: "Advanced sales",
    icon: SlidersHorizontal,
    requiresSettingsAccess: true,
  },
];

export function BackOfficeNavigation({
  mobile = false,
  canUsePos = false,
  canViewReceipts = false,
  canManageShifts = false,
  canManageCustomers = false,
  canViewReports = false,
  canManageSettings = false,
  canViewKitchen = false,
  canUseApprovals = false,
  canUseInventory = false,
  canUseTimeClock = false,
  canManageDevices = false,
}: {
  mobile?: boolean;
  canUsePos?: boolean;
  canViewReceipts?: boolean;
  canManageShifts?: boolean;
  canManageCustomers?: boolean;
  canViewReports?: boolean;
  canManageSettings?: boolean;
  canViewKitchen?: boolean;
  canUseApprovals?: boolean;
  canUseInventory?: boolean;
  canUseTimeClock?: boolean;
  canManageDevices?: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Back Office"
      className={cn(
        mobile
          ? "flex gap-1 overflow-x-auto px-4 pb-3"
          : "grid gap-1 px-3 py-5",
      )}
    >
      {navigation
        .filter(
          (item) =>
            (!item.requiresSalesAccess || canUsePos) &&
            (!item.requiresReceiptAccess || canViewReceipts) &&
            (!item.requiresShiftAccess || canManageShifts) &&
            (!item.requiresCustomerAccess || canManageCustomers) &&
            (!item.requiresReportsAccess || canViewReports) &&
            (!item.requiresSettingsAccess || canManageSettings) &&
            (!item.requiresKitchenAccess || canViewKitchen) &&
            (!item.requiresApprovalAccess || canUseApprovals) &&
            (!item.requiresInventoryAccess || canUseInventory) &&
            (!item.requiresTimeClockAccess || canUseTimeClock) &&
            (!item.requiresDeviceAccess || canManageDevices),
        )
        .map(({ href, icon: Icon, label }) => {
          const active =
            href === "/back-office"
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              href={href}
              key={href}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </Link>
          );
        })}
    </nav>
  );
}
