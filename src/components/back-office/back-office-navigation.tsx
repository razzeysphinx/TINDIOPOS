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
  canCountInventory?: boolean;
  canManageInventory?: boolean;
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
  /** The route name used in breadcrumbs when it differs from the menu label. */
  breadcrumbLabel?: string;
  /** The full page heading when the compact sidebar label is intentionally shorter. */
  pageTitle?: string;
  /** A meaningful label for icon-only navigation and assistive technology. */
  accessibleLabel?: string;
  href: string;
  label: string;
  icon: LucideIcon;
  /** Every Back Office destination must declare its permission-aware visibility rule. */
  isVisible: (access: BackOfficeNavigationAccess) => boolean;
};

type NavigationGroup = {
  id: string;
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
    id: "reports",
    icon: BarChart3,
    label: "Reports",
    items: [
      {
        href: "/back-office/reports",
        // The existing reports workspace contains the sales, product,
        // category, employee, payment, discount, tax, and inventory views.
        // Keep one permission-gated destination instead of duplicating the
        // same reporting surface in the sidebar.
        label: "Business",
        breadcrumbLabel: "Business Reports",
        pageTitle: "Business Reports",
        accessibleLabel: "Business Reports",
        icon: BarChart3,
        isVisible: (access) => access.canViewReports === true,
      },
      {
        href: "/back-office/shifts",
        label: "Shifts",
        breadcrumbLabel: "Shift Reports",
        pageTitle: "Shift Reports",
        accessibleLabel: "Shift Reports",
        icon: CircleDollarSign,
        isVisible: (access) => access.canViewShiftHistory === true,
      },
    ],
  },
  {
    id: "sales",
    icon: CircleDollarSign,
    label: "Sales",
    items: [
      {
        href: "/back-office/receipts",
        // Returns are reviewed and actioned from the immutable receipt
        // record, so a separate link would only duplicate this destination.
        label: "Receipts",
        breadcrumbLabel: "Receipts",
        icon: ReceiptText,
        isVisible: (access) => access.canViewReceipts === true,
      },
    ],
  },
  {
    id: "operations",
    // Kitchen is an authorized operational display, not a Back Office sales
    // management page. Its distinct group preserves that workspace boundary.
    icon: ChefHat,
    label: "Operations",
    items: [
      {
        href: "/kitchen",
        label: "Kitchen",
        breadcrumbLabel: "Kitchen display",
        pageTitle: "Kitchen display",
        accessibleLabel: "Kitchen display",
        icon: ChefHat,
        isVisible: (access) => access.canViewKitchen === true,
      },
    ],
  },
  {
    id: "catalog",
    icon: PackageSearch,
    label: "Catalog",
    items: [
      { href: "/back-office/catalog", label: "Catalog", icon: PackageSearch, isVisible: (access) => access.canManageCatalog === true },
      { href: "/back-office/categories", label: "Categories", icon: Shapes, isVisible: (access) => access.canManageCatalog === true },
    ],
  },
  {
    id: "inventory",
    icon: Warehouse,
    label: "Inventory",
    items: [
      {
        href: "/back-office/inventory",
        label: "Stock Control",
        icon: Warehouse,
        isVisible: (access) => access.canUseInventory === true,
      },
      {
        href: "/back-office/replenishment?tab=levels",
        label: "Stock & Restock",
        icon: Truck,
        isVisible: (access) => access.canUseInventory === true,
      },
      {
        href: "/back-office/purchasing?tab=purchase-orders",
        label: "Purchasing",
        icon: PackageSearch,
        isVisible: (access) => access.canManageInventory === true,
      },
    ],
  },
  {
    id: "customers",
    icon: Users,
    label: "Customers",
    items: [
      {
        href: "/back-office/customers",
        label: "Customers",
        breadcrumbLabel: "Customers & Loyalty",
        pageTitle: "Customers & Loyalty",
        accessibleLabel: "Customers & Loyalty",
        icon: Users,
        isVisible: (access) => access.canManageCustomers === true,
      },
    ],
  },
  {
    id: "team",
    icon: Users,
    label: "Team",
    items: [
      { href: "/back-office/employees", label: "Employees", icon: Users, isVisible: (access) => access.canManageEmployees === true },
      {
        href: "/back-office/roles",
        label: "Roles",
        breadcrumbLabel: "Roles & Access",
        pageTitle: "Roles & Access",
        accessibleLabel: "Roles & Access",
        icon: ShieldCheck,
        isVisible: (access) => access.canManageRoles === true,
      },
      {
        href: "/back-office/time-clock",
        label: "Attendance",
        breadcrumbLabel: "Time & Attendance",
        pageTitle: "Time & Attendance",
        accessibleLabel: "Time & Attendance",
        icon: Clock3,
        isVisible: (access) => access.canUseTimeClock === true,
      },
      {
        href: "/back-office/security",
        label: "Approvals & Audit",
        icon: ShieldCheck,
        isVisible: (access) => access.canUseApprovals === true,
      },
    ],
  },
  {
    id: "management",
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
        label: "Devices",
        breadcrumbLabel: "POS Devices",
        pageTitle: "POS Devices",
        accessibleLabel: "POS Devices",
        icon: MonitorSmartphone,
        isVisible: (access) => access.canManageDevices === true,
      },
      {
        href: "/back-office/offline-sync",
        label: "Sync",
        breadcrumbLabel: "Offline Sync",
        pageTitle: "Offline Sync",
        accessibleLabel: "Offline Sync",
        icon: CloudUpload,
        isVisible: (access) => access.canManageDevices === true,
      },
    ],
  },
  {
    id: "settings",
    icon: Settings2,
    label: "Settings",
    items: [
      {
        href: "/back-office/business-profile",
        label: "Business",
        breadcrumbLabel: "Business profile & features",
        pageTitle: "Business profile & features",
        accessibleLabel: "Business profile & features",
        icon: Settings2,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/payment-methods",
        label: "Payments",
        breadcrumbLabel: "Payment methods",
        pageTitle: "Payment methods",
        accessibleLabel: "Payment methods",
        icon: Settings2,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/receipt-settings",
        label: "Receipts",
        breadcrumbLabel: "Receipt settings",
        pageTitle: "Receipt settings",
        accessibleLabel: "Receipt settings",
        icon: ReceiptText,
        isVisible: (access) => access.canManageSettings === true,
      },
      {
        href: "/back-office/advanced-sales",
        label: "Discounts & Taxes",
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

// These legacy management routes remain supported for bookmarked links. They
// intentionally do not become duplicate sidebar destinations, but the shared
// application header must still identify them accurately.
const supplementalPageTitles: Record<string, string> = {
  "/back-office/registers": "Registers",
  "/back-office/stores": "Stores",
};

function routePathname(href: string) {
  return href.split("?", 1)[0] || href;
}

function isCurrentRoute(pathname: string, href: string) {
  const destinationPathname = routePathname(href);

  return destinationPathname === "/back-office"
    ? pathname === href
    : pathname === destinationPathname || pathname.startsWith(`${destinationPathname}/`);
}

export type BackOfficeBreadcrumb = {
  href?: string;
  label: string;
};

/**
 * Resolves the breadcrumb from the same permission-aware navigation registry
 * used by the sidebar. Detail routes use their server-rendered page title as a
 * final label, so an internal route parameter is never presented as a UUID.
 */
export function getBackOfficeBreadcrumbs(
  pathname: string,
  currentLabel: string,
  access: BackOfficeNavigationAccess | null,
): BackOfficeBreadcrumb[] {
  if (!access) return [];

  const entries = [
    ...primaryNavigation.map((item) => ({ item, group: null as NavigationGroup | null })),
    ...navigationGroups.flatMap((group) => group.items.map((item) => ({ item, group }))),
  ].sort((first, second) => second.item.href.length - first.item.href.length);
  const match = entries.find(({ item }) => item.isVisible(access) && isCurrentRoute(pathname, item.href));

  if (!match) return [];

  const result: BackOfficeBreadcrumb[] = [{ href: "/back-office", label: "Back Office" }];
  const itemLabel = match.item.breadcrumbLabel ?? match.item.pageTitle ?? match.item.label;
  const isDetailRoute = pathname !== routePathname(match.item.href);

  const append = (item: BackOfficeBreadcrumb) => {
    if (result.at(-1)?.label !== item.label) result.push(item);
  };

  if (match.group) append({ label: match.group.label });
  append({ href: isDetailRoute ? match.item.href : undefined, label: itemLabel });

  const normalizedCurrentLabel = currentLabel.trim();
  if (isDetailRoute && normalizedCurrentLabel && result.at(-1)?.label !== normalizedCurrentLabel) {
    append({ label: normalizedCurrentLabel });
  }

  return result;
}

export function getBackOfficePageTitle(pathname: string) {
  const supplementalTitle = supplementalPageTitles[pathname];
  if (supplementalTitle) return supplementalTitle;

  const navigationItems = [...primaryNavigation, ...navigationGroups.flatMap((group) => group.items)]
    .sort((first, second) => second.href.length - first.href.length);

  const item = navigationItems.find((candidate) => isCurrentRoute(pathname, candidate.href));

  return item?.pageTitle ?? item?.breadcrumbLabel ?? item?.label ?? "Back Office";
}

function NavigationLink({
  href,
  icon: Icon,
  label,
  accessibleLabel,
  pageTitle,
  breadcrumbLabel,
  active,
  collapsed = false,
  onNavigate,
}: NavigationItem & { active: boolean; collapsed?: boolean; onNavigate?: () => void }) {
  const navigationLabel = accessibleLabel ?? pageTitle ?? breadcrumbLabel ?? label;
  const link = (
    <Link
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? navigationLabel : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-lg py-2 text-sm font-medium transition-colors",
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

  return collapsed ? <Tooltip content={navigationLabel} side="right">{link}</Tooltip> : link;
}

function ExpandableNavigationGroup({
  group,
  pathname,
  onNavigate,
  isOpen,
  onToggle,
}: {
  group: NavigationGroup;
  pathname: string;
  onNavigate?: () => void;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const hasActiveItem = group.items.some((item) => isCurrentRoute(pathname, item.href));
  const Icon = group.icon;
  const submenuId = `back-office-navigation-${group.id}`;

  return (
    <section className="rounded-lg">
      <button
        aria-controls={submenuId}
        aria-expanded={isOpen}
        className={cn(
          "flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.12em] transition-colors",
          hasActiveItem || isOpen
            ? "text-foreground hover:bg-muted"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        onClick={onToggle}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{group.label}</span>
        </span>
        <ChevronDown
          className={cn("size-4 transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      {isOpen ? (
        <div className="mt-1 grid gap-1 border-l border-border pl-2" id={submenuId}>
          {group.items.map((item) => (
            <NavigationLink
              {...item}
              active={isCurrentRoute(pathname, item.href)}
              key={item.href}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </section>
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
          "flex min-h-11 w-full items-center justify-center rounded-lg px-2 py-2 text-sm font-medium transition-colors",
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
  const [openGroupState, setOpenGroupState] = useState<{ id: string; pathname: string } | null>(null);
  const [popupPosition, setPopupPosition] = useState<{ left: number; top: number } | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLButtonElement>());
  const openGroupId = openGroupState?.pathname === pathname ? openGroupState.id : null;
  const openGroup = groups.find((group) => group.id === openGroupId);

  useEffect(() => {
    if (!openGroupId) {
      return;
    }

    const updatePopupPosition = () => {
      const section = sectionRefs.current.get(openGroupId);
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
  }, [openGroupId]);

  const toggleGroup = (groupId: string) => {
    if (openGroupId === groupId) {
      setOpenGroupState(null);
      setPopupPosition(null);
      return;
    }

    const section = sectionRefs.current.get(groupId);
    setOpenGroupState({ id: groupId, pathname });
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
              isOpen={openGroupId === group.id}
              key={group.id}
              onClick={() => toggleGroup(group.id)}
              sectionRef={(element) => {
                if (element) {
                  sectionRefs.current.set(group.id, element);
                } else {
                  sectionRefs.current.delete(group.id);
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

function getActiveNavigationGroupId(pathname: string, groups: NavigationGroup[]) {
  return groups.find((group) => group.items.some((item) => isCurrentRoute(pathname, item.href)))?.id ?? null;
}

/**
 * Desktop navigation and the mobile sheet deliberately share one accordion:
 * a route change reopens its parent, while a user may close that parent until
 * they navigate again.
 */
function useNavigationAccordion(pathname: string, groups: NavigationGroup[]) {
  const activeGroupId = getActiveNavigationGroupId(pathname, groups);
  const groupIds = `,${groups.map((group) => group.id).join(",")},`;
  const previousPathname = useRef(pathname);
  const [openGroupId, setOpenGroupId] = useState<string | null>(() => activeGroupId);

  useEffect(() => {
    if (previousPathname.current === pathname) return;

    previousPathname.current = pathname;
    setOpenGroupId(activeGroupId);
  }, [activeGroupId, pathname]);

  useEffect(() => {
    setOpenGroupId((currentGroupId) => {
      if (currentGroupId && groupIds.includes(`,${currentGroupId},`)) {
        return currentGroupId;
      }

      return activeGroupId;
    });
  }, [activeGroupId, groupIds]);

  return {
    openGroupId,
    toggleGroup: (groupId: string) => {
      setOpenGroupId((currentGroupId) => (currentGroupId === groupId ? null : groupId));
    },
  };
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
  const { openGroupId, toggleGroup } = useNavigationAccordion(pathname, visibleNavigationGroups);
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
          ? "min-h-0 flex-1 overflow-y-auto bg-background px-4 py-3"
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
          <ExpandableNavigationGroup
            group={group}
            isOpen={openGroupId === group.id}
            key={group.id}
            onNavigate={mobile ? onNavigate : undefined}
            onToggle={() => toggleGroup(group.id)}
            pathname={pathname}
          />
        ))}
      </div>
    </nav>
  );
}
