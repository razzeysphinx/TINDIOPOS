import Link from "next/link";

import { cn } from "@/lib/utils";

export type InventoryControlTab =
  | "overview"
  | "health"
  | "activity"
  | "adjustments"
  | "counts"
  | "transfers"
  | "production"
  | "valuation";

export type StockRestockTab = "levels" | "needs-restocking" | "requests";
export type PurchasingTab = "purchase-orders" | "receiving" | "suppliers" | "supplier-returns";
export type InventoryWorkspace = "control" | "restock" | "purchasing";

type InventoryWorkspaceNavigationProps = {
  activeTab: InventoryControlTab | StockRestockTab | PurchasingTab;
  canCount?: boolean;
  canManage: boolean;
  canView?: boolean;
  canUseProduction?: boolean;
  storeId?: string | null;
  workspace: InventoryWorkspace;
};

type InventoryNavigationItem = {
  id: InventoryControlTab | StockRestockTab | PurchasingTab;
  label: string;
};

const inventoryControlItems: readonly InventoryNavigationItem[] = [
  { id: "overview", label: "Overview" },
  { id: "health", label: "Stock Health" },
  { id: "activity", label: "Inventory activity" },
  { id: "adjustments", label: "Stock adjustments" },
  { id: "counts", label: "Inventory counts" },
  { id: "transfers", label: "Transfer orders" },
  { id: "production", label: "Production" },
  { id: "valuation", label: "Inventory valuation" },
];

const purchasingItems: readonly InventoryNavigationItem[] = [
  { id: "purchase-orders", label: "Purchase orders" },
  { id: "receiving", label: "Receiving" },
  { id: "suppliers", label: "Suppliers" },
  { id: "supplier-returns", label: "Supplier returns" },
];

const restockItems: readonly InventoryNavigationItem[] = [
  { id: "levels", label: "Stock levels" },
  { id: "needs-restocking", label: "Needs restocking" },
  { id: "requests", label: "Restock requests" },
];

function tabHref(workspace: InventoryWorkspace, tab: string, storeId?: string | null) {
  const query = new URLSearchParams({ tab });
  if (storeId) query.set("store", storeId);
  if (workspace === "control") return `/back-office/inventory?${query.toString()}`;
  if (workspace === "restock") return `/back-office/replenishment?${query.toString()}`;
  return `/back-office/purchasing?${query.toString()}`;
}

/**
 * The shared inventory IA is deliberately link-based. It keeps deep links,
 * browser navigation, permission checks on the server pages, and one source
 * of truth for the three sibling Inventory workspaces.
 */
export function InventoryWorkspaceNavigation({
  activeTab,
  canCount = false,
  canManage,
  canView = false,
  canUseProduction = false,
  storeId,
  workspace,
}: InventoryWorkspaceNavigationProps) {
  const visibleControlItems = inventoryControlItems.filter((item) => {
    if (!canManage && !(canView && (item.id === "overview" || item.id === "health" || item.id === "activity")) && !(canCount && item.id === "counts")) return false;
    return item.id !== "production" || canUseProduction;
  });
  const visiblePurchasingItems = purchasingItems.filter(() => canManage);
  const restockNavigationItems = restockItems.filter((item) => canManage || item.id === "levels");
  const title = workspace === "control"
    ? "Inventory Control sections"
    : workspace === "restock"
      ? "Stock & Restock sections"
      : "Purchasing sections";

  const renderLink = (item: InventoryNavigationItem) => {
    const active = activeTab === item.id;

    return (
      <Link
        aria-current={active ? "page" : undefined}
        className={cn(
          "whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
        href={tabHref(workspace, item.id, storeId)}
        key={item.id}
      >
        {item.label}
      </Link>
    );
  };

  return (
    <nav aria-label={title} className="rounded-xl border bg-card p-2">
      {workspace === "control" ? (
        <div className="flex flex-wrap items-center gap-1">
          {visibleControlItems.map(renderLink)}
        </div>
      ) : workspace === "restock" ? (
        <div className="flex flex-wrap items-center gap-1">
          {restockNavigationItems.map(renderLink)}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1">
          {visiblePurchasingItems.map(renderLink)}
        </div>
      )}
    </nav>
  );
}
