"use client";

import { useEffect, useRef, useState } from "react";
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
import { createPortal } from "react-dom";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type BackOfficeNavigationAccess = {
  canViewReceipts?: boolean;
  canViewDashboard?: boolean;
  canManageCustomers?: boolean;
  canViewReports?: boolean;
  canViewShiftHistory?: boolean;
  canManageSettings?: boolean;
  canViewKitchen?: boolean;
  canUseApprovals?: boolean;
  canUseInventory?: boolean;
  canUseTimeClock?: boolean;
  canManageDevices?: boolean;
  canManageCatalog?: boolean;
  canManageAdvancedSales?: boolean;
  canManageEmployees?: boolean;
  canManageRoles?: boolean;
  canManageStores?: boolean;
  canManageRegisters?: boolean;
};

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Every Back Office destination must declare its permission-aware visibility rule. */
  isVisible: (access: BackOfficeNavigationAccess) => boolean;
};

type NavigationGroup = {
  icon: LucideIcon;
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
];

const navigationGroups: NavigationGroup[] = [
  {
    icon: BarChart3,
    label: "Reports",
    items: [
      {
        href: "/back-office/reports",
        // The existing reports workspace contains the sales, product,
        // category, employee, payment, discount, tax, and inventory views.
        // Keep one permission-gated destination instead of duplicating the
        // same reporting surface in the sidebar.
        label: "Business reports",
        icon: BarChart3,
        isVisible: (access) => access.canViewReports === true,
      },
      {
        href: "/back-office/shifts",
        label: "Shift reports",
        icon: CircleDollarSign,
        isVisible: (access) => access.canViewShiftHistory === true,
      },
    ],
  },
  {
    icon: CircleDollarSign,
    label: "Sales",
    items: [
      {
        href: "/back-office/receipts",
        // Returns are reviewed and actioned from the immutable receipt
        // record, so a separate link would only duplicate this destination.
        label: "Receipts & returns",
        icon: ReceiptText,
        isVisible: (access) => access.canViewReceipts === true,
      },
    ],
  },
  {
    // Kitchen is an authorized operational display, not a Back Office sales
    // management page. Its distinct group preserves that workspace boundary.
    icon: ChefHat,
    label: "Operations",
    items: [
      {
        href: "/kitchen",
        label: "Kitchen display",
        icon: ChefHat,
        isVisible: (access) => access.canViewKitchen === true,
      },
    ],
  },
  {
    icon: PackageSearch,
    label: "Catalog",
    items: [
      { href: "/back-office/catalog", label: "Products", icon: PackageSearch, isVisible: (access) => access.canManageCatalog === true },
      { href: "/back-office/categories", label: "Categories", icon: Shapes, isVisible: (access) => access.canManageCatalog === true },
    ],
  },
  {
    icon: Warehouse,
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
        label: "Restock items",
        icon: Truck,
        isVisible: (access) => access.canUseInventory === true,
      },
    ],
  },
  {
    icon: Users,
    label: "Customers",
    items: [
      {
        href: "/back-office/customers",
        label: "Customers & loyalty",
        icon: Users,
        isVisible: (access) => access.canManageCustomers === true,
      },
    ],
  },
  {
    icon: Users,
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
    icon: Store,
    label: "Management",
    items: [
      {
        href: "/back-office/stores-registers",
        label: "Stores & Registers",
        icon: Store,
        isVisible: (access) => access.canManageStores === true || access.canManageRegisters === true,
      },
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
    icon: Settings2,
    label: "Settings",
    items: [
      {
        href: "/back-office/business-profile",
        label: "Business profile & features",
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
        isVisible: (access) => access.canManageAdvancedSales === true,
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

export function getBackOfficePageTitle(pathname: string) {
  const navigationItems = [...primaryNavigation, ...navigationGroups.flatMap((group) => group.items)]
    .sort((first, second) => second.href.length - first.href.length);

  return navigationItems.find((item) => isCurrentRoute(pathname, item.href))?.label ?? "Back Office";
}

function NavigationLink({
  href,
  icon: Icon,
  label,
  active,
  collapsed = false,
  onNavigate,
}: NavigationItem & { active: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const link = (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? label : undefined}
      className={cn(
        "flex min-h-10 items-center rounded-lg py-2 text-sm font-medium transition-colors",
        collapsed ? "justify-center px-2" : "gap-3 px-3",
        active
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      href={href}
      onClick={onNavigate}
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      {collapsed ? null : <span className="min-w-0 truncate">{label}</span>}
    </Link>
  );

  return collapsed ? <Tooltip content={label} side="right">{link}</Tooltip> : link;
}

function ExpandableNavigationGroup({
  group,
  pathname,
  onNavigate,
}: {
  group: NavigationGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  const hasActiveItem = group.items.some((item) => isCurrentRoute(pathname, item.href));
  const [isOpen, setIsOpen] = useState(hasActiveItem);
  const Icon = group.icon;

  return (
    <details
      className="group rounded-lg"
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
      open={isOpen}
    >
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{group.label}</span>
        </span>
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
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </details>
  );
}

function CollapsedNavigationSection({
  active,
  group,
  isOpen,
  onClick,
  sectionRef,
}: {
  active: boolean;
  group: NavigationGroup;
  isOpen: boolean;
  onClick: () => void;
  sectionRef: (element: HTMLButtonElement | null) => void;
}) {
  const Icon = group.icon;

  return (
    <Tooltip content={group.label} side="right">
      <button
        aria-expanded={isOpen}
        aria-label={`${isOpen ? "Close" : "Open"} ${group.label} submenu`}
        className={cn(
          "flex min-h-10 w-full items-center justify-center rounded-lg px-2 py-2 text-sm font-medium transition-colors",
          active || isOpen
            ? "bg-secondary text-secondary-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        onClick={onClick}
        ref={sectionRef}
        type="button"
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
      </button>
    </Tooltip>
  );
}

function CollapsedNavigation({
  groups,
  onNavigate,
  pathname,
  primaryItems,
}: {
  groups: NavigationGroup[];
  onNavigate?: () => void;
  pathname: string;
  primaryItems: NavigationItem[];
}) {
  const [openGroupState, setOpenGroupState] = useState<{ label: string; pathname: string } | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number } | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLButtonElement>());
  const openGroupLabel = openGroupState?.pathname === pathname ? openGroupState.label : null;
  const openGroup = groups.find((group) => group.label === openGroupLabel);

  useEffect(() => {
    if (!openGroupLabel) {
      return;
    }

    const updatePopupPosition = () => {
      const section = sectionRefs.current.get(openGroupLabel);
      if (!section) return;

      const sectionRect = section.getBoundingClientRect();
      const popupHeight = popupRef.current?.getBoundingClientRect().height ?? 0;
      const viewportPadding = 8;
      setPopupPosition({
        left: sectionRect.right + viewportPadding,
        top: Math.max(
          viewportPadding,
          Math.min(sectionRect.top, window.innerHeight - popupHeight - viewportPadding),
        ),
      });
    };
    const closeWhenClickingOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node &&
        (navigationRef.current?.contains(target) || popupRef.current?.contains(target))
      ) {
        return;
      }
      setOpenGroupState(null);
    };

    const frame = window.requestAnimationFrame(updatePopupPosition);
    document.addEventListener("pointerdown", closeWhenClickingOutside);
    window.addEventListener("resize", updatePopupPosition);
    window.addEventListener("scroll", updatePopupPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeWhenClickingOutside);
      window.removeEventListener("resize", updatePopupPosition);
      window.removeEventListener("scroll", updatePopupPosition, true);
    };
  }, [openGroupLabel]);

  const toggleGroup = (groupLabel: string) => {
    if (openGroupLabel === groupLabel) {
      setOpenGroupState(null);
      setPopupPosition(null);
      return;
    }

    const section = sectionRefs.current.get(groupLabel);
    setOpenGroupState({ label: groupLabel, pathname });
    setPopupPosition(
      section
        ? { left: section.getBoundingClientRect().right + 8, top: section.getBoundingClientRect().top }
        : null,
    );
  };

  return (
    <nav aria-label="Back Office" className="relative min-h-0 flex-1" ref={navigationRef}>
      <div className="h-full overflow-y-auto px-2 py-4">
        <div className="grid gap-1">
          {primaryItems.map((item) => (
            <NavigationLink
              {...item}
              active={isCurrentRoute(pathname, item.href)}
              collapsed
              key={item.href}
              onNavigate={onNavigate}
            />
          ))}
        </div>
        <div className="mt-2 grid gap-1">
          {groups.map((group) => (
            <CollapsedNavigationSection
              active={group.items.some((item) => isCurrentRoute(pathname, item.href))}
              group={group}
              isOpen={openGroupLabel === group.label}
              key={group.label}
              onClick={() => toggleGroup(group.label)}
              sectionRef={(element) => {
                if (element) {
                  sectionRefs.current.set(group.label, element);
                } else {
                  sectionRefs.current.delete(group.label);
                }
              }}
            />
          ))}
        </div>
      </div>

      {typeof document !== "undefined" && openGroup
        ? createPortal(
            <div
              aria-label={`${openGroup.label} submenu`}
              className={cn(
                "fixed z-50 max-h-[calc(100svh-1rem)] w-64 overflow-y-auto rounded-xl border border-border bg-popover p-2 shadow-lg",
                popupPosition ? undefined : "invisible",
              )}
              ref={popupRef}
              style={popupPosition ?? { left: 0, top: 0 }}
            >
              <p className="px-2 py-1 text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                {openGroup.label}
              </p>
              <div className="mt-1 grid gap-1">
                {openGroup.items.map((item) => (
                  <NavigationLink
                    {...item}
                    active={isCurrentRoute(pathname, item.href)}
                    key={item.href}
                    onNavigate={() => {
                      setOpenGroupState(null);
                      onNavigate?.();
                    }}
                  />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </nav>
  );
}

function NavigationGroupSection({
  group,
  pathname,
  onNavigate,
}: {
  group: NavigationGroup;
  pathname: string;
  onNavigate?: () => void;
}) {
  return <ExpandableNavigationGroup group={group} onNavigate={onNavigate} pathname={pathname} />;
}

export function BackOfficeNavigation({
  collapsed = false,
  mobile = false,
  onNavigate,
  ...access
}: BackOfficeNavigationAccess & { collapsed?: boolean; mobile?: boolean; onNavigate?: () => void }) {
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
  const iconOnly = collapsed && !mobile;

  if (iconOnly) {
    return (
      <CollapsedNavigation
        groups={visibleNavigationGroups}
        onNavigate={onNavigate}
        pathname={pathname}
        primaryItems={visiblePrimaryNavigation}
      />
    );
  }

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
            onNavigate={mobile ? onNavigate : undefined}
          />
        ))}
      </div>

      <div className={cn(iconOnly ? "mt-2 grid gap-1" : "mt-4 grid gap-2")}>
        {visibleNavigationGroups.map((group) => (
          <NavigationGroupSection
            group={group}
            key={`${pathname}:${group.label}`}
            onNavigate={mobile ? onNavigate : undefined}
            pathname={pathname}
          />
        ))}
      </div>
    </nav>
  );
}
