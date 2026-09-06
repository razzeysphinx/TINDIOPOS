import { ArrowDown, ArrowUp, Boxes, PackageOpen, Warehouse } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DashboardActionGrid } from "@/features/dashboard/dashboard-action-grid";
import {
  AdvancedInventoryWorkflows,
  type AdvancedGoodsReceipt,
  type AdvancedPurchaseOrder,
} from "@/features/inventory/advanced-inventory-workflows";
import type { InventorySaleableItem } from "@/features/catalog/catalog-forms";
import { InventoryIntegrityWorkflows } from "@/features/inventory/inventory-integrity-workflows";
import { InventoryActivityList } from "@/features/inventory/inventory-activity-list";
import { InventoryCountWorkspace } from "@/features/inventory/inventory-count-workspace";
import {
  InventoryControlTower,
  InventoryHealthWorkspace,
  type InventoryHealthIssue,
  type InventoryHealthSeverity,
} from "@/features/inventory/inventory-health-workspace";
import { SupplyChainWorkflows, type ReplenishmentRule } from "@/features/inventory/supply-chain-workflows";
import {
  InventoryProductDetail,
  type InventoryProductDetailData,
} from "@/features/inventory/inventory-product-detail";
import { type InventoryStockStatus } from "@/features/inventory/inventory-stock-view";
import { getInventoryStockCondition } from "@/features/inventory/inventory-stock-status";
import { InventoryTransferWorkspace } from "@/features/inventory/inventory-transfer-workspace";
import {
  InventoryWorkspaceNavigation,
  type InventoryControlTab,
  type InventoryWorkspace,
  type PurchasingTab,
} from "@/features/inventory/inventory-workspace-navigation";
import { resolveBackOfficeStoreScope } from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import type { TableRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Inventory" };

const INVENTORY_CONTROL_TABS: readonly { id: InventoryControlTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "health", label: "Stock Health" },
  { id: "activity", label: "Activity" },
  { id: "adjustments", label: "Stock adjustments" },
  { id: "counts", label: "Counts" },
  { id: "transfers", label: "Transfers" },
  { id: "production", label: "Production" },
  { id: "valuation", label: "Valuation" },
];

const PURCHASING_TABS: readonly PurchasingTab[] = [
  "purchase-orders",
  "receiving",
  "suppliers",
  "supplier-returns",
];

const INVENTORY_TABS = [
  ...INVENTORY_CONTROL_TABS,
  ...PURCHASING_TABS.map((id) => ({ id, label: id.replaceAll("-", " ") })),
] as const;

type InventoryTab = InventoryControlTab | PurchasingTab;

export type InventoryWorkspacePageProps = {
  searchParams: Promise<{
    configuration?: string | string[];
    detail?: string | string[];
    from?: string | string[];
    movementType?: string | string[];
    purchaseOrder?: string | string[];
    status?: string | string[];
    severity?: string | string[];
    store?: string;
    tab?: string | string[];
    to?: string | string[];
  }>;
};

const INVENTORY_STOCK_STATUSES = [
  "all",
  "attention",
  "available",
  "in_stock",
  "low",
  "negative",
  "out_of_stock",
] as const satisfies readonly InventoryStockStatus[];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOVEMENT_TYPES = ["OPENING_STOCK", "ADJUSTMENT", "DAMAGE", "LOSS", "SALE", "REFUND", "RECEIPT", "COUNT", "TRANSFER_OUT", "TRANSFER_IN", "SUPPLIER_RETURN", "PRODUCTION", "DISASSEMBLY"] as const;

function resolveInventoryTab(value: string | string[] | undefined, workspace: "control" | "purchasing"): InventoryTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate === "purchasing") return "purchase-orders";
  const allowedTabs = workspace === "purchasing" ? PURCHASING_TABS : INVENTORY_CONTROL_TABS.map((tab) => tab.id);
  if (allowedTabs.includes(candidate as never)) return candidate as InventoryTab;
  return workspace === "purchasing" ? "purchase-orders" : "overview";
}

function resolveInventoryStockStatus(value: string | string[] | undefined): InventoryStockStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  return INVENTORY_STOCK_STATUSES.some((status) => status === candidate)
    ? candidate as InventoryStockStatus
    : "all";
}

function resolveInventoryLevelId(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
}

function resolveDate(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function resolveMovementType(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return MOVEMENT_TYPES.includes(candidate as (typeof MOVEMENT_TYPES)[number]) ? candidate as (typeof MOVEMENT_TYPES)[number] : null;
}

function resolveHealthSeverity(value: string | string[] | undefined): InventoryHealthSeverity | "all" {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "critical" || candidate === "warning" || candidate === "information" ? candidate : "all";
}

async function loadInventoryItemActivity({
  limit,
  organizationId,
  productId,
  storeId,
  supabase,
  variantId,
}: {
  limit: number;
  organizationId: string;
  productId: string;
  storeId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
  variantId: string | null;
}) {
  const query = supabase
    .from("inventory_movements")
    .select("id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after, movement_type, actor_employee_id, reason, reason_code, source_type, source_id, created_at")
    .eq("organization_id", organizationId)
    .eq("store_id", storeId)
    .eq("product_id", productId);

  if (variantId) query.eq("variant_id", variantId);
  else query.is("variant_id", null);

  return query.order("created_at", { ascending: false }).limit(limit);
}

/** CANDIDATE_FOR_REMOVAL: retained while shared InventoryWorkspaceNavigation completes QA. */
export function InventoryTabs({
  activeTab,
  canManage,
  storeId,
}: {
  activeTab: InventoryTab;
  canManage: boolean;
  storeId: string | null;
}) {
  const tabs = canManage
    ? INVENTORY_TABS
    : INVENTORY_TABS.filter((tab) => tab.id === "activity");

  return (
    <nav aria-label="Inventory sections" className="overflow-x-auto overscroll-x-contain border-b">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTab;

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "border-b-2 px-3 py-3 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
              href={`/back-office/inventory?tab=${tab.id}${storeId ? `&store=${storeId}` : ""}`}
              key={tab.id}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export default async function InventoryPage(props: InventoryWorkspacePageProps) {
  return <InventoryWorkspacePage {...props} workspace="control" />;
}

/**
 * Shared server-rendered inventory data surface. The control and purchasing
 * routes deliberately reuse this loader so their authorization, store scope,
 * purchase-order, receiving, and ledger behavior cannot drift apart.
 */
export async function InventoryWorkspacePage({
  searchParams,
  workspace,
}: InventoryWorkspacePageProps & { workspace: Extract<InventoryWorkspace, "control" | "purchasing"> }) {
  const context = await requireBackOfficePermission(["inventory.view", "inventory.count", "inventory.manage"]);
  const parameters = await searchParams;
  const rawRequestedTab = Array.isArray(parameters.tab) ? parameters.tab[0] : parameters.tab;
  if (rawRequestedTab === "stock") {
    const query = new URLSearchParams({ tab: "levels" });
    if (parameters.store) query.set("store", parameters.store);
    if (parameters.detail && !Array.isArray(parameters.detail)) query.set("detail", parameters.detail);
    redirect(`/back-office/replenishment?${query.toString()}`);
  }
  const canManage = hasPermission(context, "inventory.manage");
  const canCount = hasPermission(context, "inventory.count") || canManage;
  const canViewInventory = hasPermission(context, "inventory.view") || canCount;
  const selectedStore = parameters.store;
  const purchaseOrder = Array.isArray(parameters.purchaseOrder) ? parameters.purchaseOrder[0] : parameters.purchaseOrder;
  const legacyPurchasingTab = rawRequestedTab === "purchasing"
    ? "purchase-orders"
    : PURCHASING_TABS.includes(rawRequestedTab as PurchasingTab)
      ? rawRequestedTab as PurchasingTab
      : null;
  const legacyControlTab = INVENTORY_CONTROL_TABS.some((tab) => tab.id === rawRequestedTab)
    ? rawRequestedTab as InventoryControlTab
    : null;

  if (workspace === "control" && legacyPurchasingTab) {
    const query = new URLSearchParams({ tab: legacyPurchasingTab });
    if (selectedStore) query.set("store", selectedStore);
    if (purchaseOrder) query.set("purchaseOrder", purchaseOrder);
    redirect(`/back-office/purchasing?${query.toString()}`);
  }

  if (workspace === "purchasing" && legacyControlTab) {
    const query = new URLSearchParams({ tab: legacyControlTab });
    if (selectedStore) query.set("store", selectedStore);
    redirect(`/back-office/inventory?${query.toString()}`);
  }

  if (workspace === "purchasing" && !canManage) {
    const query = new URLSearchParams({ tab: "activity" });
    if (selectedStore) query.set("store", selectedStore);
    redirect(`/back-office/inventory?${query.toString()}`);
  }

  const requestedTab = resolveInventoryTab(parameters.tab, workspace);
  const canOpenRequestedTab = canManage
    || (canViewInventory && ["overview", "health", "activity"].includes(requestedTab))
    || (canCount && requestedTab === "counts");
  const activeTab = workspace === "purchasing" || canOpenRequestedTab ? requestedTab : "activity";
  // CANDIDATE_FOR_REMOVAL: retained while the legacy stock query parameter is
  // still accepted for backwards-compatible deep links to Stock & Restock.
  const initialStockStatus = resolveInventoryStockStatus(parameters.status);
  void initialStockStatus;
  const requestedDetailLevelId = resolveInventoryLevelId(parameters.detail);
  const requestedPurchaseOrderId = resolveInventoryLevelId(parameters.purchaseOrder);
  const showConfiguration = parameters.configuration === "1" || parameters.configuration?.[0] === "1";
  const activityFrom = resolveDate(parameters.from);
  const activityTo = resolveDate(parameters.to);
  const activityMovementType = resolveMovementType(parameters.movementType);
  const selectedDetailLevelId = activeTab === "activity"
    ? requestedDetailLevelId
    : null;
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();

  if (!context.features.inventory) {
    return (
      <div className="space-y-8">
        <PageHeader
          action={<Badge variant="outline">Feature disabled</Badge>}
          description="Historical inventory records remain protected, but inventory workflows are currently disabled for this business."
          eyebrow="Inventory"
          title="Inventory"
        />
        <BackOfficeStateCard
          description="An owner or administrator can enable it in Business profile & features."
          icon={<Boxes className="size-5" aria-hidden="true" />}
          title="Inventory is disabled"
        />
      </div>
    );
  }

  const supabase = await createClient();
  const organizationId = context.organization.id;
  const canViewCosts = hasPermission(context, "products.view_cost");
  const selectedStoreId = storeScope.selectedStoreId;
  const scopedStoreIds = selectedStoreId ? [selectedStoreId] : storeScope.storeIds;
  const settingsQuery = supabase
    .from("product_store_settings")
    .select("product_id, store_id, is_available")
    .eq("organization_id", organizationId);
  const levelsQuery = supabase
    .from("inventory_levels")
    .select("id, store_id, product_id, variant_id, quantity, updated_at")
    .eq("organization_id", organizationId);
  const valuationQuery = activeTab === "valuation" && canViewCosts
    ? supabase.rpc("get_inventory_valuation", { target_organization_id: organizationId })
    : Promise.resolve({ data: [], error: null });
  const replenishmentRulesQuery = canManage
    ? supabase
        .from("inventory_replenishment_rules")
        .select("id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock")
        .eq("organization_id", organizationId)
    : null;
  const purchaseOrdersQuery = canManage
    ? supabase
        .from("purchase_orders")
        .select("id, supplier_id, store_id, order_number, status, expected_at, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(30)
    : null;
  const inventoryPoliciesQuery = canManage
    ? supabase
        .from("inventory_policies")
        .select("store_id, negative_stock_policy")
        .eq("organization_id", organizationId)
    : null;
  const inventoryPolicyDefaultsQuery = canManage
    ? supabase
        .from("inventory_policy_defaults")
        .select("negative_stock_policy")
        .eq("organization_id", organizationId)
        .limit(1)
    : null;
  const recentMovementsQuery = ["overview", "health", "activity"].includes(activeTab)
    ? supabase
        .from("inventory_movements")
        .select(
          "id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after, movement_type, actor_employee_id, reason, reason_code, source_type, source_id, created_at",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(30)
    : null;

  if (activityFrom) recentMovementsQuery?.gte("created_at", `${activityFrom}T00:00:00.000Z`);
  if (activityTo) recentMovementsQuery?.lt("created_at", `${activityTo}T23:59:59.999Z`);
  if (activityMovementType) recentMovementsQuery?.eq("movement_type", activityMovementType);
  const inventoryCountsQuery = canCount && ["overview", "health", "counts"].includes(activeTab)
    ? supabase
        .from("inventory_counts")
        .select("id, count_number, store_id, status, note, started_at, completed_at, updated_at, count_mode, scope_type, scope_reference_id, sort_mode, include_zero_stock")
        .eq("organization_id", organizationId)
        .in("status", ["draft", "in_progress", "ready_for_review", "posted", "cancelled", "open", "completed"])
        .order("started_at", { ascending: false })
        .limit(25)
    : null;
  const countAwarenessQuery = workspace === "control"
    ? supabase.rpc("get_inventory_health_awareness", { target_organization_id: organizationId })
    : null;
  const offlineInventoryIssuesQuery = hasPermission(context, "devices.manage") && ["overview", "health"].includes(activeTab)
    ? supabase
        .from("offline_sync_events")
        .select("id, store_id, store_name_snapshot, state, conflict_type")
        .eq("organization_id", organizationId)
        .in("state", ["CONFLICT", "FAILED"])
        .order("last_attempt_at", { ascending: false })
        .limit(50)
    : null;

  if (scopedStoreIds) {
    settingsQuery.in("store_id", scopedStoreIds);
    levelsQuery.in("store_id", scopedStoreIds);
    replenishmentRulesQuery?.in("store_id", scopedStoreIds);
    purchaseOrdersQuery?.in("store_id", scopedStoreIds);
    inventoryPoliciesQuery?.in("store_id", scopedStoreIds);
    recentMovementsQuery?.in("store_id", scopedStoreIds);
    inventoryCountsQuery?.in("store_id", scopedStoreIds);
  }

  const [
    storesResult,
    categoriesResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    valuationResult,
    movementsResult,
    suppliersResult,
    purchaseOrdersResult,
    inventoryPoliciesResult,
    inventoryPolicyDefaultsResult,
    adjustmentReasonsResult,
    stockTransfersResult,
    stockTransferLinesResult,
    replenishmentRulesResult,
    inventoryCountsResult,
    warehousesResult,
    countSuppliersResult,
    countAwarenessResult,
    offlineInventoryIssuesResult,
  ] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("categories")
      .select("id, name, is_archived")
      .eq("organization_id", organizationId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabase
      .from("products")
      .select("id, category_id, name, sku, barcode, product_type, is_composite, unit, status, track_inventory")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .eq("track_inventory", true)
      .order("name", { ascending: true }),
    supabase
      .from("product_variants")
      .select("id, product_id, name, sku, barcode, sort_order, is_active")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    settingsQuery,
    levelsQuery,
    valuationQuery,
    recentMovementsQuery ?? Promise.resolve({
          data: [] as Array<
            Pick<
              TableRow<"inventory_movements">,
              | "id"
              | "store_id"
              | "product_id"
              | "variant_id"
              | "quantity_delta"
              | "quantity_before"
              | "quantity_after"
              | "movement_type"
              | "actor_employee_id"
              | "reason"
              | "reason_code"
              | "source_type"
              | "source_id"
              | "created_at"
            >
          >,
          error: null,
        }),
    canManage
      ? supabase
          .from("suppliers")
          .select("id, name, contact_name, email, phone, address, notes, is_active, lead_time_days")
          .eq("organization_id", organizationId)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    purchaseOrdersQuery ?? Promise.resolve({ data: [], error: null }),
    inventoryPoliciesQuery ?? Promise.resolve({ data: [], error: null }),
    inventoryPolicyDefaultsQuery ?? Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("inventory_adjustment_reasons")
          .select("code, name, movement_type")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("stock_transfers")
          .select("id, source_store_id, destination_store_id, status, note")
          .eq("organization_id", organizationId)
          .in("status", ["in_transit", "partially_received"])
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("stock_transfer_lines")
          .select("id, stock_transfer_id, product_id, variant_id, quantity, received_quantity")
          .eq("organization_id", organizationId)
      : Promise.resolve({ data: [], error: null }),
    replenishmentRulesQuery ?? Promise.resolve({ data: [], error: null }),
    inventoryCountsQuery ?? Promise.resolve({
      data: [] as Array<Pick<TableRow<"inventory_counts">, "id" | "count_number" | "store_id" | "status" | "note" | "started_at" | "completed_at" | "updated_at" | "count_mode" | "scope_type" | "scope_reference_id" | "sort_mode" | "include_zero_stock">>,
      error: null,
    }),
    canManage && showConfiguration
      ? supabase
          .from("supply_chain_warehouses")
          .select("id, store_id, code, name")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    canCount && activeTab === "counts"
      ? supabase.rpc("get_inventory_count_suppliers", { target_organization_id: organizationId })
      : Promise.resolve({ data: [], error: null }),
    countAwarenessQuery ?? Promise.resolve({ data: [], error: null }),
    offlineInventoryIssuesQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  const error = [
    storesResult,
    categoriesResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    valuationResult,
    movementsResult,
    suppliersResult,
    purchaseOrdersResult,
    inventoryPoliciesResult,
    inventoryPolicyDefaultsResult,
    adjustmentReasonsResult,
    stockTransfersResult,
    stockTransferLinesResult,
    replenishmentRulesResult,
    inventoryCountsResult,
    countSuppliersResult,
    countAwarenessResult,
    offlineInventoryIssuesResult,
  ].find((result) => result.error)?.error;

  if (error) {
    throw new Error(`Unable to load inventory: ${error.message}`);
  }

  const visibleStore = (storeId: string) => scopedStoreIds === null || scopedStoreIds.includes(storeId);
  const stores = (storesResult.data ?? []).filter((store) => visibleStore(store.id));
  const categories = categoriesResult.data ?? [];
  const products = productsResult.data ?? [];
  const variants = variantsResult.data ?? [];
  const settings = (settingsResult.data ?? []).filter((setting) => visibleStore(setting.store_id));
  const levels = (levelsResult.data ?? []).filter((level) => visibleStore(level.store_id));
  const inventoryValuation = (valuationResult.data ?? []).filter((entry) => visibleStore(entry.store_id));
  const movements = (movementsResult.data ?? []).filter((movement) => visibleStore(movement.store_id));
  const suppliers = suppliersResult.data ?? [];
  const purchaseOrders = (purchaseOrdersResult.data ?? []).filter((order) => visibleStore(order.store_id));
  const inventoryCounts = (inventoryCountsResult.data ?? []).filter((count) => visibleStore(count.store_id));
  const countSuppliers = countSuppliersResult.data ?? [];
  const countAwareness = (countAwarenessResult.data ?? []).filter((entry) => visibleStore(entry.store_id));
  const offlineInventoryIssues = (offlineInventoryIssuesResult.data ?? []).filter((entry) => visibleStore(entry.store_id));
  const purchaseOrderIds = purchaseOrders.map((order) => order.id);
  const countIds = inventoryCounts.map((count) => count.id);
  const [purchaseOrderLinesResult, goodsReceiptsResult, countLinesResult] = await Promise.all([
    purchaseOrderIds.length
      ? supabase
          .from("purchase_order_lines")
          .select("id, purchase_order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, ordered_quantity, received_quantity")
          .eq("organization_id", organizationId)
          .in("purchase_order_id", purchaseOrderIds)
      : Promise.resolve({ data: [], error: null }),
    purchaseOrderIds.length
      ? supabase
          .from("goods_receipts")
          .select("id, purchase_order_id, store_id, note, received_at")
          .eq("organization_id", organizationId)
          .in("purchase_order_id", purchaseOrderIds)
          .order("received_at", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [], error: null }),
    countIds.length
      ? supabase
          .from("inventory_count_lines")
          .select("id, inventory_count_id, product_id, variant_id, expected_quantity, counted_quantity, product_name_snapshot, variant_name_snapshot, category_name_snapshot, sku_snapshot, barcode_snapshot, unit_snapshot, line_sort_order")
          .eq("organization_id", organizationId)
          .in("inventory_count_id", countIds)
          .order("line_sort_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const purchasingError = [purchaseOrderLinesResult, goodsReceiptsResult, countLinesResult].find((result) => result.error)?.error;
  if (purchasingError) {
    throw new Error(`Unable to load purchasing history: ${purchasingError.message}`);
  }

  const goodsReceiptIds = (goodsReceiptsResult.data ?? []).map((receipt) => receipt.id);
  const goodsReceiptLinesResult = goodsReceiptIds.length
    ? await supabase
        .from("goods_receipt_lines")
        .select("goods_receipt_id, purchase_order_line_id, quantity_received")
        .eq("organization_id", organizationId)
        .in("goods_receipt_id", goodsReceiptIds)
    : { data: [], error: null };

  if (goodsReceiptLinesResult.error) {
    throw new Error(`Unable to load receiving history: ${goodsReceiptLinesResult.error.message}`);
  }

  const purchaseOrderLines = purchaseOrderLinesResult.data ?? [];
  const goodsReceipts = goodsReceiptsResult.data ?? [];
  const goodsReceiptLines = goodsReceiptLinesResult.data ?? [];
  const inventoryCountLines = countLinesResult.data ?? [];
  const purchaseOrderLineIds = purchaseOrderLines.map((line) => line.id);
  const purchaseOrderLineCostRows: Array<{ id: string; unit_cost_minor: number }> = [];
  // The permission-checked RPC intentionally accepts no more than 100 IDs.
  // Keep this page compatible with unusually large purchase-order histories
  // without weakening that database-side input bound.
  if (canViewCosts) {
    for (let start = 0; start < purchaseOrderLineIds.length; start += 100) {
      const purchaseOrderLineCostsResult = await supabase.rpc("get_purchase_order_line_costs", {
        requested_purchase_order_line_ids: purchaseOrderLineIds.slice(start, start + 100),
        target_organization_id: organizationId,
      });

      if (purchaseOrderLineCostsResult.error) {
        throw new Error(`Unable to load purchase order costs: ${purchaseOrderLineCostsResult.error.message}`);
      }

      purchaseOrderLineCostRows.push(...(purchaseOrderLineCostsResult.data ?? []));
    }
  }

  const purchaseOrderLineCostById = new Map(
    purchaseOrderLineCostRows.map((line) => [line.id, Number(line.unit_cost_minor)]),
  );
  const inventoryPolicies = (inventoryPoliciesResult.data ?? []).filter((policy) => visibleStore(policy.store_id));
  const organizationDefaultPolicy = (inventoryPolicyDefaultsResult.data?.[0]?.negative_stock_policy as "allow" | "warn" | "block" | undefined) ?? "block";
  const canManageOrganizationDefault = canManage && storeScope.canAccessAllStores;
  const adjustmentReasons = adjustmentReasonsResult.data ?? [];
  const stockTransfers = (stockTransfersResult.data ?? []).filter((transfer) => visibleStore(transfer.source_store_id) || visibleStore(transfer.destination_store_id));
  const stockTransferLines = stockTransferLinesResult.data ?? [];
  const replenishmentRules = (replenishmentRulesResult.data ?? []).filter((rule) => visibleStore(rule.store_id));
  const warehouses = warehousesResult.data ?? [];
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const availability = new Map(
    settings.map((setting) => [
      `${setting.product_id}|${setting.store_id}`,
      setting.is_available,
    ]),
  );
  const reorderPoints = new Map(
    replenishmentRules.map((rule) => [
      `${rule.store_id}|${rule.product_id}|${rule.variant_id ?? ""}`,
      Number(rule.reorder_point),
    ]),
  );
  const averageCostByStockLevel = new Map(
    inventoryValuation.map((entry) => [
      `${entry.store_id}|${entry.product_id}|${entry.variant_id ?? ""}`,
      Number(entry.average_cost_minor),
    ]),
  );
  const selectedDetailLevel = selectedDetailLevelId
    ? levels.find((level) => level.id === selectedDetailLevelId) ?? null
    : null;

  if (selectedDetailLevelId && !selectedDetailLevel) notFound();

  const detailActivityLimit = activeTab === "activity" ? 50 : 12;
  const detailMovementsResult = selectedDetailLevel
    ? await loadInventoryItemActivity({
        limit: detailActivityLimit,
        organizationId,
        productId: selectedDetailLevel.product_id,
        storeId: selectedDetailLevel.store_id,
        supabase,
        variantId: selectedDetailLevel.variant_id,
      })
    : { data: [], error: null };

  if (detailMovementsResult.error) {
    throw new Error(`Unable to load inventory activity: ${detailMovementsResult.error.message}`);
  }

  const detailMovements = detailMovementsResult.data ?? [];
  const activityMovements = selectedDetailLevel ? detailMovements : movements;
  const activityActorSource = selectedDetailLevel || activeTab === "activity" ? activityMovements : [];
  const actorEmployeeIds = [...new Set(activityActorSource.map((movement) => movement.actor_employee_id))];
  const employeesResult = hasPermission(context, "employees.manage") && actorEmployeeIds.length
    ? await supabase
        .from("employees")
        .select("id, profile_id, employee_number")
        .eq("organization_id", organizationId)
        .in("id", actorEmployeeIds)
    : { data: [], error: null };

  if (employeesResult.error) {
    throw new Error(`Unable to load inventory activity employees: ${employeesResult.error.message}`);
  }

  const activityEmployees = employeesResult.data ?? [];
  const actorProfileIds = activityEmployees.map((employee) => employee.profile_id);
  const profilesResult = actorProfileIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", actorProfileIds)
    : { data: [], error: null };

  if (profilesResult.error) {
    throw new Error(`Unable to load inventory activity employee names: ${profilesResult.error.message}`);
  }

  const receiptSaleIds = [...new Set(activityActorSource.flatMap((movement) => (
    movement.source_id && (movement.source_type === "sale" || movement.source_type === "composite_sale")
      ? [movement.source_id]
      : []
  )))];
  const receiptsResult = hasPermission(context, "receipts.view") && receiptSaleIds.length
    ? await supabase
        .from("receipts")
        .select("id, sale_id, receipt_number")
        .eq("organization_id", organizationId)
        .in("sale_id", receiptSaleIds)
    : { data: [], error: null };

  if (receiptsResult.error) {
    throw new Error(`Unable to load inventory activity receipt references: ${receiptsResult.error.message}`);
  }

  const profileNames = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile.full_name]));
  const actorNames = new Map<string, string>();
  actorNames.set(context.employee.id, context.profile.full_name || context.profile.email || context.employee.employee_number);
  for (const employee of activityEmployees) {
    actorNames.set(employee.id, profileNames.get(employee.profile_id) || employee.employee_number);
  }
  const receiptBySaleId = new Map((receiptsResult.data ?? []).map((receipt) => [receipt.sale_id, receipt]));
  const movementSourceIds = (sourceType: string) => [...new Set(
    activityMovements
      .filter((movement) => movement.source_type === sourceType && movement.source_id && UUID_PATTERN.test(movement.source_id))
      .map((movement) => movement.source_id as string),
  )];
  const adjustmentSourceIds = movementSourceIds("inventory_adjustment");
  const countSourceIds = movementSourceIds("inventory_count");
  const goodsReceiptSourceIds = movementSourceIds("goods_receipt");
  const transferSourceIds = movementSourceIds("stock_transfer");
  const [adjustmentDocumentsResult, countDocumentsResult, goodsReceiptDocumentsResult, transferDocumentsResult] = await Promise.all([
    canManage && adjustmentSourceIds.length
      ? supabase
          .from("inventory_adjustments")
          .select("id, adjustment_number")
          .eq("organization_id", organizationId)
          .in("id", adjustmentSourceIds)
      : Promise.resolve({ data: [], error: null }),
    canCount && countSourceIds.length
      ? supabase
          .from("inventory_counts")
          .select("id, count_number")
          .eq("organization_id", organizationId)
          .in("id", countSourceIds)
      : Promise.resolve({ data: [], error: null }),
    canManage && goodsReceiptSourceIds.length
      ? supabase
          .from("goods_receipts")
          .select("id, purchase_order_id")
          .eq("organization_id", organizationId)
          .in("id", goodsReceiptSourceIds)
      : Promise.resolve({ data: [], error: null }),
    canManage && transferSourceIds.length
      ? supabase
          .from("stock_transfers")
          .select("id")
          .eq("organization_id", organizationId)
          .in("id", transferSourceIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const sourceDocumentError = [adjustmentDocumentsResult, countDocumentsResult, goodsReceiptDocumentsResult, transferDocumentsResult].find((result) => result.error)?.error;
  if (sourceDocumentError) {
    throw new Error(`Unable to load inventory source documents: ${sourceDocumentError.message}`);
  }
  const items = products.flatMap<InventorySaleableItem>((product) => {
    const storeIds = settings
      .filter(
        (setting) =>
          setting.product_id === product.id &&
          setting.is_available &&
          storeNames.has(setting.store_id),
      )
      .map((setting) => setting.store_id);

    if (product.product_type === "simple") {
      return [{ productId: product.id, variantId: null, label: product.name, storeIds, identifiers: [product.sku, product.barcode].filter((value): value is string => Boolean(value)) }];
    }

    return variants
      .filter((variant) => variant.product_id === product.id)
      .map((variant) => ({
        productId: product.id,
        variantId: variant.id,
        label: `${product.name} / ${variant.name}`,
        storeIds,
        identifiers: [variant.sku, variant.barcode].filter((value): value is string => Boolean(value)),
      }));
  });
  const quantitiesBySaleable = new Map<string, Record<string, number>>();

  for (const level of levels) {
    const saleableKey = `${level.product_id}|${level.variant_id ?? ""}`;
    const quantities = quantitiesBySaleable.get(saleableKey) ?? {};
    quantities[level.store_id] = Number(level.quantity);
    quantitiesBySaleable.set(saleableKey, quantities);
  }

  const advancedItems = items.map((item) => ({
    ...item,
    barcode: item.variantId
      ? variantById.get(item.variantId)?.barcode ?? null
      : productById.get(item.productId)?.barcode ?? null,
    categoryId: productById.get(item.productId)?.category_id ?? null,
    categoryName: productById.get(item.productId)?.category_id
      ? categoryNames.get(productById.get(item.productId)?.category_id ?? "") ?? "Uncategorized"
      : "Uncategorized",
    identifiers: item.identifiers ?? [],
    sku: item.variantId
      ? variantById.get(item.variantId)?.sku ?? null
      : productById.get(item.productId)?.sku ?? null,
    unit: productById.get(item.productId)?.unit ?? "units",
    quantitiesByStore:
      quantitiesBySaleable.get(`${item.productId}|${item.variantId ?? ""}`) ?? {},
  }));
  const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.id, `${warehouse.code} · ${warehouse.name}`]));
  const configurationRules: ReplenishmentRule[] = replenishmentRules.map((rule) => {
    const product = productById.get(rule.product_id);
    const variant = rule.variant_id ? variantById.get(rule.variant_id) : null;
    const item = advancedItems.find((candidate) => candidate.productId === rule.product_id && candidate.variantId === rule.variant_id);
    return {
      id: rule.id,
      storeId: rule.store_id,
      productId: rule.product_id,
      variantId: rule.variant_id,
      preferredWarehouseId: rule.preferred_warehouse_id,
      reorderPoint: Number(rule.reorder_point),
      targetStock: Number(rule.target_stock),
      label: item?.label ?? `${product?.name ?? "Unavailable product"}${variant ? ` / ${variant.name}` : ""}`,
      unit: item?.unit ?? product?.unit ?? "units",
      currentQuantity: item?.quantitiesByStore[rule.store_id] ?? 0,
      storeName: storeNames.get(rule.store_id) ?? "Inactive store",
      warehouseName: rule.preferred_warehouse_id ? warehouseNames.get(rule.preferred_warehouse_id) ?? "Unavailable warehouse" : null,
    };
  });
  const countLinesByDocument = new Map<string, typeof inventoryCountLines>();
  for (const line of inventoryCountLines) {
    const savedLines = countLinesByDocument.get(line.inventory_count_id) ?? [];
    savedLines.push(line);
    countLinesByDocument.set(line.inventory_count_id, savedLines);
  }
  const inventoryCountDocuments = inventoryCounts.map((count) => ({
    countMode: count.count_mode as "standard" | "blind",
    id: count.id,
    includeZeroStock: count.include_zero_stock,
    countNumber: Number(count.count_number),
    scopeReferenceId: count.scope_reference_id,
    scopeType: count.scope_type as "full_store" | "category" | "supplier" | "selected",
    sortMode: count.sort_mode as "category_name" | "supplier_name" | "sku" | "barcode" | "product_name",
    storeName: storeNames.get(count.store_id) ?? "Inactive store",
    status: count.status as "draft" | "in_progress" | "ready_for_review" | "posted" | "cancelled" | "open" | "completed",
    note: count.note,
    updatedAt: count.updated_at,
    lines: (countLinesByDocument.get(count.id) ?? []).map((line) => {
      return {
        id: line.id,
        productId: line.product_id,
        variantId: line.variant_id,
        label: `${line.product_name_snapshot}${line.variant_name_snapshot ? ` / ${line.variant_name_snapshot}` : ""}`,
        categoryName: line.category_name_snapshot,
        sku: line.sku_snapshot,
        barcode: line.barcode_snapshot,
        unit: line.unit_snapshot,
        expectedQuantity: Number(line.expected_quantity),
        countedQuantity: line.counted_quantity === null ? null : Number(line.counted_quantity),
      };
    }),
  }));
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const purchaseOrderLinesByOrder = new Map<string, typeof purchaseOrderLines>();

  for (const line of purchaseOrderLines) {
    const lines = purchaseOrderLinesByOrder.get(line.purchase_order_id) ?? [];
    lines.push(line);
    purchaseOrderLinesByOrder.set(line.purchase_order_id, lines);
  }

  const purchaseOrderHistory: AdvancedPurchaseOrder[] = purchaseOrders
    .map((order) => ({
      id: order.id,
      orderNumber: Number(order.order_number),
      status: order.status as AdvancedPurchaseOrder["status"],
      supplierName: supplierNames.get(order.supplier_id) ?? "Unavailable supplier",
      storeName: storeNames.get(order.store_id) ?? "Inactive store",
      expectedAt: order.expected_at,
      createdAt: order.created_at,
      totalCostMinor: (purchaseOrderLinesByOrder.get(order.id) ?? []).reduce(
        (total, line) => total + Number(line.ordered_quantity) * (purchaseOrderLineCostById.get(line.id) ?? 0),
        0,
      ),
      lines: (purchaseOrderLinesByOrder.get(order.id) ?? [])
        .map((line) => ({
          id: line.id,
          label: `${line.product_name_snapshot}${line.variant_name_snapshot ? ` / ${line.variant_name_snapshot}` : ""}`,
          unit: line.unit_snapshot,
          orderedQuantity: Number(line.ordered_quantity),
          receivedQuantity: Number(line.received_quantity),
          // This is a client component: only serialize values returned by the
          // permission-checked cost RPC, never a raw table cost.
          unitCostMinor: purchaseOrderLineCostById.get(line.id) ?? 0,
        })),
    }));
  const receivableOrders = purchaseOrderHistory.filter(
    (order) => (order.status === "ordered" || order.status === "partially_received") && order.lines.some((line) => line.receivedQuantity < line.orderedQuantity),
  );
  const purchaseOrderLineById = new Map(purchaseOrderLines.map((line) => [line.id, line]));
  const receiptLinesByReceipt = new Map<string, AdvancedGoodsReceipt["lines"]>();
  for (const line of goodsReceiptLines) {
    const purchaseOrderLine = purchaseOrderLineById.get(line.purchase_order_line_id);
    if (!purchaseOrderLine) continue;
    const receiptLines = receiptLinesByReceipt.get(line.goods_receipt_id) ?? [];
    receiptLines.push({
      label: `${purchaseOrderLine.product_name_snapshot}${purchaseOrderLine.variant_name_snapshot ? ` / ${purchaseOrderLine.variant_name_snapshot}` : ""}`,
      quantity: Number(line.quantity_received),
      unit: purchaseOrderLine.unit_snapshot,
    });
    receiptLinesByReceipt.set(line.goods_receipt_id, receiptLines);
  }
  const purchaseOrderNumberById = new Map(purchaseOrderHistory.map((order) => [order.id, order.orderNumber]));
  const recentGoodsReceipts: AdvancedGoodsReceipt[] = goodsReceipts.map((receipt) => ({
    id: receipt.id,
    lines: receiptLinesByReceipt.get(receipt.id) ?? [],
    note: receipt.note,
    purchaseOrderId: receipt.purchase_order_id,
    purchaseOrderNumber: purchaseOrderNumberById.get(receipt.purchase_order_id) ?? 0,
    receivedAt: receipt.received_at,
    storeName: storeNames.get(receipt.store_id) ?? "Inactive store",
  }));
  const transferLinesByTransfer = new Map<string, typeof stockTransferLines>();

  for (const line of stockTransferLines) {
    const lines = transferLinesByTransfer.get(line.stock_transfer_id) ?? [];
    lines.push(line);
    transferLinesByTransfer.set(line.stock_transfer_id, lines);
  }

  const inTransitTransfers = stockTransfers
    .map((transfer) => ({
      id: transfer.id,
      sourceStoreName: storeNames.get(transfer.source_store_id) ?? "Inactive store",
      destinationStoreName: storeNames.get(transfer.destination_store_id) ?? "Inactive store",
      note: transfer.note,
      status: transfer.status as "in_transit" | "partially_received",
      lines: (transferLinesByTransfer.get(transfer.id) ?? [])
        .filter((line) => Number(line.received_quantity) < Number(line.quantity))
        .map((line) => ({
          id: line.id,
          label: `${productById.get(line.product_id)?.name ?? "Unavailable product"}${line.variant_id ? ` / ${variantById.get(line.variant_id)?.name ?? "Unavailable variant"}` : ""}`,
          unit: productById.get(line.product_id)?.unit ?? "units",
          quantity: Number(line.quantity),
          receivedQuantity: Number(line.received_quantity),
        })),
    }))
    .filter((transfer) => transfer.lines.length > 0);
  const policiesByStore = Object.fromEntries(
    inventoryPolicies.map((policy) => [
      policy.store_id,
      policy.negative_stock_policy as "allow" | "warn" | "block",
    ]),
  );
  const compositeProducts = products
    .filter((product) => product.is_composite)
    .map((product) => ({
      id: product.id,
      name: product.name,
      unit: product.unit,
      storeIds: settings
        .filter(
          (setting) =>
            setting.product_id === product.id &&
            setting.is_available &&
            storeNames.has(setting.store_id),
        )
        .map((setting) => setting.store_id),
    }));
  const outOfStockCount = levels.filter((level) => Number(level.quantity) === 0).length;
  const negativeStockCount = levels.filter((level) => Number(level.quantity) < 0).length;
  const needsAttentionCount = outOfStockCount + negativeStockCount;
  const inventoryTabHref = (tab: InventoryControlTab) =>
    `/back-office/inventory?tab=${tab}${storeScope.selectedStoreId ? `&store=${storeScope.selectedStoreId}` : ""}`;
  const purchasingTabHref = (tab: PurchasingTab) =>
    `/back-office/purchasing?tab=${tab}${storeScope.selectedStoreId ? `&store=${storeScope.selectedStoreId}` : ""}`;
  const sourceDocumentReferences = new Map<string, { href: string | null; label: string }>();
  for (const adjustment of adjustmentDocumentsResult.data ?? []) {
    sourceDocumentReferences.set(`inventory_adjustment:${adjustment.id}`, {
      href: null,
      label: `Adjustment SA-${String(adjustment.adjustment_number).padStart(6, "0")}`,
    });
  }
  for (const count of countDocumentsResult.data ?? []) {
    sourceDocumentReferences.set(`inventory_count:${count.id}`, {
      href: null,
      label: `Count IC-${String(count.count_number).padStart(6, "0")}`,
    });
  }
  for (const receipt of goodsReceiptDocumentsResult.data ?? []) {
    sourceDocumentReferences.set(`goods_receipt:${receipt.id}`, {
      href: `${purchasingTabHref("receiving")}&purchaseOrder=${receipt.purchase_order_id}`,
      label: `Receiving GR-${receipt.id.slice(0, 8).toUpperCase()}`,
    });
  }
  for (const transfer of transferDocumentsResult.data ?? []) {
    sourceDocumentReferences.set(`stock_transfer:${transfer.id}`, {
      href: null,
      label: `Transfer TR-${transfer.id.slice(0, 8).toUpperCase()}`,
    });
  }
  const sourceReferenceForMovement = (movement: typeof activityMovements[number]) => {
    const receipt = movement.source_id ? receiptBySaleId.get(movement.source_id) : undefined;
    if (receipt) return { href: `/back-office/receipts/${receipt.id}`, label: `Receipt ${receipt.receipt_number}` };
    return movement.source_id
      ? sourceDocumentReferences.get(`${movement.source_type}:${movement.source_id}`) ?? {
          href: null,
          label: formatInventorySourceReference(movement.source_type),
        }
      : { href: null, label: formatInventorySourceReference(movement.source_type) };
  };
  const purchasingSectionLabels: Record<PurchasingTab, string> = {
    "purchase-orders": "Purchase orders",
    receiving: "Receiving",
    suppliers: "Suppliers",
    "supplier-returns": "Supplier returns",
  };
  const controlSectionLabels: Partial<Record<InventoryControlTab, string>> = {
    health: "Stock Health",
    adjustments: "Stock adjustments",
    counts: "Inventory counts",
    production: "Production",
    transfers: "Transfer orders",
    valuation: "Inventory valuation",
  };
  const breadcrumbs = workspace === "purchasing"
    ? [
        { href: "/back-office", label: "Back Office" },
        { href: inventoryTabHref("overview"), label: "Inventory" },
        { href: purchasingTabHref("purchase-orders"), label: "Purchasing" },
        { label: purchasingSectionLabels[activeTab as PurchasingTab] },
      ]
    : [
        { href: "/back-office", label: "Back Office" },
        { href: inventoryTabHref("overview"), label: "Inventory" },
        { label: controlSectionLabels[activeTab as InventoryControlTab] ?? "Inventory Control" },
      ];
  const stockLevelsHref = (status?: InventoryStockStatus) =>
    `/back-office/replenishment?tab=levels${storeScope.selectedStoreId ? `&store=${storeScope.selectedStoreId}` : ""}${status && status !== "all" ? `&status=${status}` : ""}`;
  const inventoryDetailHref = (levelId: string) =>
    `${inventoryTabHref("activity")}&detail=${levelId}`;
  const stockRows = levels.flatMap((level) => {
    const product = productById.get(level.product_id);
    const variant = level.variant_id ? variantById.get(level.variant_id) : undefined;
    const storeName = storeNames.get(level.store_id);

    if (!product || !storeName) return [];

    return [{
      averageCostMinor: canViewCosts
        ? averageCostByStockLevel.get(`${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`) ?? null
        : null,
      barcode: variant?.barcode ?? product.barcode,
      categoryId: product.category_id,
      categoryName: product.category_id ? categoryNames.get(product.category_id) ?? "Uncategorized" : "Uncategorized",
      detailHref: inventoryDetailHref(level.id),
      id: level.id,
      isAvailable: availability.get(`${level.product_id}|${level.store_id}`) === true,
      productId: level.product_id,
      productName: product.name,
      quantity: Number(level.quantity),
      reorderPoint: canManage ? reorderPoints.get(`${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`) ?? null : null,
      sku: variant?.sku ?? product.sku,
      storeId: level.store_id,
      storeName,
      unit: product.unit,
      updatedAt: level.updated_at,
      variantId: level.variant_id,
      variantName: variant?.name ?? null,
    }];
  });
  const countAwarenessByPosition = new Map(
    countAwareness.map((entry) => [`${entry.store_id}|${entry.product_id}|${entry.variant_id ?? ""}`, entry]),
  );
  // CANDIDATE_FOR_REMOVAL: retained source data for the previous Inventory
  // stock-list surface. Stock & Restock now owns that workspace.
  void stockRows;
  const selectedDetailProduct = selectedDetailLevel ? productById.get(selectedDetailLevel.product_id) : undefined;
  const selectedDetailVariant = selectedDetailLevel?.variant_id
    ? variantById.get(selectedDetailLevel.variant_id)
    : undefined;
  const inventoryDetail: InventoryProductDetailData | null = selectedDetailLevel && selectedDetailProduct
    ? (() => {
        const positionKey = `${selectedDetailLevel.store_id}|${selectedDetailLevel.product_id}|${selectedDetailLevel.variant_id ?? ""}`;
        const lastCount = countAwarenessByPosition.get(positionKey);
        const incomingQuantity = purchaseOrders
          .filter((order) => order.store_id === selectedDetailLevel.store_id && ["draft", "ordered", "partially_received"].includes(order.status))
          .flatMap((order) => purchaseOrderLinesByOrder.get(order.id) ?? [])
          .filter((line) => line.product_id === selectedDetailLevel.product_id && line.variant_id === selectedDetailLevel.variant_id)
          .reduce((total, line) => total + Math.max(0, Number(line.ordered_quantity) - Number(line.received_quantity)), 0);
        const inTransitQuantity = stockTransfers
          .filter((transfer) => transfer.destination_store_id === selectedDetailLevel.store_id)
          .flatMap((transfer) => transferLinesByTransfer.get(transfer.id) ?? [])
          .filter((line) => line.product_id === selectedDetailLevel.product_id && line.variant_id === selectedDetailLevel.variant_id)
          .reduce((total, line) => total + Math.max(0, Number(line.quantity) - Number(line.received_quantity)), 0);

        return {
        activity: detailMovements.map((movement) => {
          const sourceReference = sourceReferenceForMovement(movement);
          return {
            actorName: actorNames.get(movement.actor_employee_id) ?? null,
            createdAt: movement.created_at,
            id: movement.id,
            movementType: movement.movement_type,
            quantityAfter: Number(movement.quantity_after),
            quantityBefore: Number(movement.quantity_before),
            quantityDelta: Number(movement.quantity_delta),
            reason: movement.reason_code ?? movement.reason ?? "No reason recorded",
            referenceHref: sourceReference.href,
            referenceLabel: sourceReference.label,
            storeName: storeNames.get(movement.store_id) ?? "Unavailable store",
          };
        }),
        adjustmentHref: canManage ? inventoryTabHref("adjustments") : null,
        barcode: selectedDetailVariant?.barcode ?? selectedDetailProduct.barcode,
        categoryName: selectedDetailProduct.category_id ? categoryNames.get(selectedDetailProduct.category_id) ?? "Uncategorized" : "Uncategorized",
        closeHref: inventoryTabHref("activity"),
        condition: getInventoryStockCondition({
          quantity: Number(selectedDetailLevel.quantity),
          reorderPoint: reorderPoints.get(`${selectedDetailLevel.store_id}|${selectedDetailLevel.product_id}|${selectedDetailLevel.variant_id ?? ""}`) ?? null,
        }),
        fullActivityHref: inventoryDetailHref(selectedDetailLevel.id),
        countHref: canCount ? inventoryTabHref("counts") : null,
        incomingQuantity,
        isAvailable: availability.get(`${selectedDetailLevel.product_id}|${selectedDetailLevel.store_id}`) === true,
        productName: selectedDetailProduct.name,
        inTransitQuantity,
        lastCount: lastCount?.last_counted_at && lastCount.count_number !== null && lastCount.expected_quantity !== null && lastCount.counted_quantity !== null ? {
          countedAt: lastCount.last_counted_at,
          countedQuantity: Number(lastCount.counted_quantity),
          countNumber: Number(lastCount.count_number),
          expectedQuantity: Number(lastCount.expected_quantity),
        } : null,
        purchasingHref: canManage ? purchasingTabHref("purchase-orders") : null,
        quantity: Number(selectedDetailLevel.quantity),
        reorderPoint: reorderPoints.get(`${selectedDetailLevel.store_id}|${selectedDetailLevel.product_id}|${selectedDetailLevel.variant_id ?? ""}`) ?? null,
        sku: selectedDetailVariant?.sku ?? selectedDetailProduct.sku,
        storeName: storeNames.get(selectedDetailLevel.store_id) ?? "Unavailable store",
        stores: levels
          .filter((level) => level.product_id === selectedDetailLevel.product_id && level.variant_id === selectedDetailLevel.variant_id)
          .map((level) => {
            const reorderPoint = reorderPoints.get(`${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`) ?? null;
            return {
              condition: getInventoryStockCondition({ quantity: Number(level.quantity), reorderPoint }),
              isAvailable: availability.get(`${level.product_id}|${level.store_id}`) === true,
              quantity: Number(level.quantity),
              reorderPoint,
              storeName: storeNames.get(level.store_id) ?? "Unavailable store",
            };
          })
          .sort((left, right) => left.storeName.localeCompare(right.storeName)),
        unit: selectedDetailProduct.unit,
        transferHref: canManage ? inventoryTabHref("transfers") : null,
        variantName: selectedDetailVariant?.name ?? null,
        };
      })()
    : null;
  const activityItemLabel = selectedDetailProduct
    ? `${selectedDetailProduct.name}${selectedDetailVariant ? ` / ${selectedDetailVariant.name}` : ""}`
    : null;
  const activityMovementIds = activityMovements.map((movement) => movement.id);
  const movementCostsResult = canViewCosts && activityMovementIds.length
    ? await supabase.rpc("get_inventory_movement_costs", {
        requested_movement_ids: activityMovementIds,
        target_organization_id: organizationId,
      })
    : { data: [], error: null };

  if (movementCostsResult.error) {
    throw new Error(`Unable to load inventory movement costs: ${movementCostsResult.error.message}`);
  }

  const movementCostById = new Map(
    (movementCostsResult.data ?? []).map((movement) => [
      movement.id,
      {
        unitCostMinor: Number(movement.unit_cost_minor),
        valueDeltaMinor: Number(movement.value_delta_minor),
      },
    ]),
  );
  const activityRows = activityMovements.map((movement) => {
    const product = productById.get(movement.product_id);
    const variant = movement.variant_id ? variantById.get(movement.variant_id) : undefined;
    const movementCost = movementCostById.get(movement.id);
    const sourceReference = sourceReferenceForMovement(movement);

    return {
      actorName: actorNames.get(movement.actor_employee_id) ?? null,
      createdAt: movement.created_at,
      id: movement.id,
      movementType: movement.movement_type,
      productName: `${product?.name ?? "Unavailable product"}${variant ? ` / ${variant.name}` : ""}`,
      quantityAfter: Number(movement.quantity_after),
      quantityBefore: Number(movement.quantity_before),
      quantityDelta: Number(movement.quantity_delta),
      reason: movement.reason_code ?? movement.reason,
      note: movement.reason,
      referenceHref: sourceReference.href,
      referenceLabel: sourceReference.label,
      storeName: storeNames.get(movement.store_id) ?? "Unavailable store",
      unit: product?.unit ?? "units",
      ...(canViewCosts && movementCost ? {
        unitCostMinor: movementCost.unitCostMinor,
        valueDeltaMinor: movementCost.valueDeltaMinor,
      } : {}),
    };
  });
  const inventoryHealthIssues: InventoryHealthIssue[] = [];

  for (const row of stockRows) {
    const condition = getInventoryStockCondition({ quantity: row.quantity, reorderPoint: row.reorderPoint });
    if (condition === "negative") {
      inventoryHealthIssues.push({ detail: `${formatQuantity(row.quantity)} ${row.unit} on hand. Review its movement history before correcting it.`, href: row.detailHref, id: `negative:${row.id}`, itemName: row.variantName ? `${row.productName} / ${row.variantName}` : row.productName, issueType: "Negative stock", severity: "critical", storeId: row.storeId, storeName: row.storeName });
    } else if (condition === "low") {
      inventoryHealthIssues.push({ detail: `${formatQuantity(row.quantity)} ${row.unit} on hand against a ${formatQuantity(row.reorderPoint ?? 0)} reorder level.`, href: row.detailHref, id: `low:${row.id}`, itemName: row.variantName ? `${row.productName} / ${row.variantName}` : row.productName, issueType: "Low stock", severity: "warning", storeId: row.storeId, storeName: row.storeName });
    }

    const latestCount = countAwarenessByPosition.get(`${row.storeId}|${row.productId}|${row.variantId ?? ""}`);
    if (!latestCount?.last_counted_at) {
      inventoryHealthIssues.push({ detail: "No completed physical count is recorded for this stock position.", href: row.detailHref, id: `never-counted:${row.id}`, itemName: row.variantName ? `${row.productName} / ${row.variantName}` : row.productName, issueType: "Never physically counted", severity: "warning", storeId: row.storeId, storeName: row.storeName });
    } else if (latestCount.count_recommended) {
      inventoryHealthIssues.push({ detail: `Last physically counted ${latestCount.days_since_count ?? 0} days ago. The 30-day marker is awareness only, not an enforced policy.`, href: row.detailHref, id: `stale-count:${row.id}`, itemName: row.variantName ? `${row.productName} / ${row.variantName}` : row.productName, issueType: "Stale physical count", severity: "warning", storeId: row.storeId, storeName: row.storeName });
    }
    if (latestCount?.counted_quantity !== null && latestCount?.counted_quantity !== undefined && latestCount.expected_quantity !== null && Number(latestCount.counted_quantity) !== Number(latestCount.expected_quantity)) {
      inventoryHealthIssues.push({ detail: `Latest count expected ${formatQuantity(Number(latestCount.expected_quantity))} and found ${formatQuantity(Number(latestCount.counted_quantity))}.`, href: row.detailHref, id: `count-variance:${row.id}`, itemName: row.variantName ? `${row.productName} / ${row.variantName}` : row.productName, issueType: "Count variance", severity: "warning", storeId: row.storeId, storeName: row.storeName });
    }
  }

  for (const count of inventoryCounts.filter((entry) => entry.status === "ready_for_review")) {
    inventoryHealthIssues.push({ detail: `Inventory count IC-${String(count.count_number).padStart(6, "0")} is complete and waiting for authorized review and posting.`, href: inventoryTabHref("counts"), id: `count-review:${count.id}`, itemName: `IC-${String(count.count_number).padStart(6, "0")}`, issueType: "Count awaiting review", severity: "information", storeId: count.store_id, storeName: storeNames.get(count.store_id) ?? "Inactive store" });
  }

  const inventoryHealthTransfers = inTransitTransfers.map((transfer) => ({
    href: inventoryTabHref("transfers"),
    id: transfer.id,
    label: transfer.note || `Transfer ${transfer.id.slice(0, 8).toUpperCase()}`,
    remainingQuantity: transfer.lines.reduce((total, line) => total + Math.max(0, line.quantity - line.receivedQuantity), 0),
    route: `${transfer.sourceStoreName} → ${transfer.destinationStoreName}`,
    status: transfer.status,
  }));
  for (const transfer of inventoryHealthTransfers.filter((entry) => entry.status === "partially_received")) {
    inventoryHealthIssues.push({ detail: `${formatQuantity(transfer.remainingQuantity)} units remain unresolved after partial receiving.`, href: transfer.href, id: `transfer:${transfer.id}`, itemName: transfer.label, issueType: "Transfer discrepancy", severity: "warning", storeId: null, storeName: transfer.route });
  }
  const inventorySyncConflictsByStore = new Map<string, { count: number; storeId: string | null; storeName: string }>();
  for (const event of offlineInventoryIssues.filter((entry) => entry.conflict_type === "INVENTORY_CONFLICT")) {
    const key = event.store_id ?? event.store_name_snapshot;
    const current = inventorySyncConflictsByStore.get(key);
    inventorySyncConflictsByStore.set(key, {
      count: (current?.count ?? 0) + 1,
      storeId: event.store_id,
      storeName: event.store_name_snapshot,
    });
  }
  for (const [storeKey, conflict] of inventorySyncConflictsByStore) {
    inventoryHealthIssues.push({ detail: `${conflict.count} offline inventory operation${conflict.count === 1 ? " requires" : "s require"} reconciliation in Offline Sync. No stock correction is applied here.`, href: "/back-office/offline-sync", id: `sync:${storeKey}`, itemName: "Inventory sync conflict", issueType: "Inventory sync conflict", severity: "critical", storeId: conflict.storeId, storeName: conflict.storeName });
  }

  const healthIssuesByStore = new Map<string, number>();
  for (const issue of inventoryHealthIssues) if (issue.storeId) healthIssuesByStore.set(issue.storeId, (healthIssuesByStore.get(issue.storeId) ?? 0) + 1);
  const inventoryHealthStores = stores.map((store) => {
    const storeCountAges = countAwareness.filter((entry) => entry.store_id === store.id && entry.days_since_count !== null).map((entry) => entry.days_since_count as number);
    return {
      daysSinceLastCount: storeCountAges.sort((left, right) => left - right)[0] ?? null,
      issueCount: healthIssuesByStore.get(store.id) ?? 0,
      name: store.name,
      openTransferCount: inTransitTransfers.filter((transfer) => transfer.sourceStoreName === store.name || transfer.destinationStoreName === store.name).length,
      storeId: store.id,
    };
  });
  inventoryHealthIssues.sort((left, right) => ({ critical: 0, warning: 1, information: 2 })[left.severity] - ({ critical: 0, warning: 1, information: 2 })[right.severity] || left.itemName.localeCompare(right.itemName));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={workspace === "purchasing" ? "Purchasing" : "Stock control"}
        title={workspace === "purchasing" ? "Purchasing" : "Inventory Control"}
        description={workspace === "purchasing"
          ? "Manage suppliers, purchase orders, deliveries, and procurement costs. Purchase orders record buying intent; only receiving changes stock."
          : "See what you have, what needs restocking, and why your stock quantity changed."}
        breadcrumbs={breadcrumbs}
        action={
          <Badge variant={canManage ? "secondary" : "outline"}>
            {canManage ? workspace === "purchasing" ? "Purchasing access" : "Stock management" : "Level view"}
          </Badge>
        }
      />

      <InventoryWorkspaceNavigation
        activeTab={activeTab}
        canCount={canCount}
        canManage={canManage}
        canView={canViewInventory}
        canUseProduction={context.features.production}
        storeId={storeScope.selectedStoreId}
        workspace={workspace}
      />

      {activeTab === "overview" ? (
        <DashboardActionGrid
          inventoryEnabled={context.features.inventory}
          permissions={context.permissions}
          surface="inventory"
        />
      ) : null}

      {activeTab === "overview" ? <InventoryControlTower
        healthHref={inventoryTabHref("health")}
        issues={inventoryHealthIssues}
        recentActivity={activityRows.map((row) => ({ href: row.referenceHref, id: row.id, label: row.productName, quantityDelta: row.quantityDelta, storeName: row.storeName }))}
        stores={inventoryHealthStores}
        transfers={inventoryHealthTransfers}
        transfersHref={inventoryTabHref("transfers")}
      /> : null}

      {activeTab === "overview" ? <Card>
        <CardHeader><CardTitle>Needs attention and shortcuts</CardTitle><CardDescription>Use Stock Levels for current balances, Activity for recent changes, and Stock Health for investigation. {needsAttentionCount} current stock position{needsAttentionCount === 1 ? " needs" : "s need"} attention: {negativeStockCount} negative and {outOfStockCount} out of stock.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-x-4 gap-y-2">
          <Link className="text-sm font-medium text-primary hover:underline" href={stockLevelsHref()}>View stock levels</Link>
          <Link className="text-sm font-medium text-primary hover:underline" href={inventoryTabHref("health")}>Review Stock Health</Link>
          <Link className="text-sm font-medium text-primary hover:underline" href={inventoryTabHref("activity")}>View activity</Link>
          {canCount ? <Link className="text-sm font-medium text-primary hover:underline" href={inventoryTabHref("counts")}>Inventory counts</Link> : null}
          {canManage ? <Link className="text-sm font-medium text-primary hover:underline" href={`${inventoryTabHref("overview")}&configuration=1`}>Inventory configuration</Link> : null}
        </CardContent>
      </Card> : null}

      {activeTab === "health" ? <InventoryHealthWorkspace
        initialSeverity={resolveHealthSeverity(parameters.severity)}
        issues={inventoryHealthIssues}
        stores={stores.map(({ id, name }) => ({ id, name }))}
      /> : null}

      {activeTab === "overview" && canManage && showConfiguration ? (
        <section aria-labelledby="inventory-configuration-title" className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold" id="inventory-configuration-title">Inventory configuration</h2>
            <p className="mt-1 text-sm text-muted-foreground">Set warehouses, supplier lead time, and replenishment rules here. Daily Stock & Restock stays focused on balances and requests.</p>
          </div>
          <SupplyChainWorkflows
            stores={stores.map(({ id, name }) => ({ id, name }))}
            warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, storeId: warehouse.store_id, code: warehouse.code, name: warehouse.name }))}
            suppliers={suppliers.filter((supplier) => supplier.is_active).map((supplier) => ({ id: supplier.id, name: supplier.name, leadTimeDays: Number(supplier.lead_time_days) }))}
            items={advancedItems}
            rules={configurationRules}
            requests={[]}
            inboundPurchaseOrders={[]}
            defaultStoreId={storeScope.selectedStoreId}
            sections={["configuration"]}
          />
        </section>
      ) : null}

      {activeTab === "overview" && canManage ? (
        <details className="group rounded-xl border bg-card" id="inventory-operations">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium marker:hidden">
            Inventory safeguards
            <span className="ml-2 text-sm font-normal text-muted-foreground">Negative-stock policy configuration</span>
          </summary>
          <div className="space-y-6 border-t p-5">
            {/* CANDIDATE_FOR_REMOVAL: the older approval-aware adjustment form remains in catalog-forms.tsx, but this page now exposes one controlled-reason adjustment workflow. */}
            <InventoryIntegrityWorkflows
              stores={stores.map(({ id, name }) => ({ id, name }))}
              items={advancedItems}
              suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
              policies={policiesByStore}
              organizationDefaultPolicy={organizationDefaultPolicy}
              canManageOrganizationDefault={canManageOrganizationDefault}
              adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
              inTransitTransfers={inTransitTransfers}
              composites={compositeProducts}
              sections={["safeguards"]}
            />
          </div>
        </details>
      ) : null}

      {(["purchase-orders", "receiving", "suppliers"] as const).includes(activeTab as "purchase-orders" | "receiving" | "suppliers") && canManage ? (
          <AdvancedInventoryWorkflows
          key={activeTab}
          stores={stores.map(({ id, name }) => ({ id, name }))}
          items={advancedItems}
          suppliers={suppliers.map((supplier) => ({
            id: supplier.id,
            name: supplier.name,
            contactName: supplier.contact_name,
            email: supplier.email,
            phone: supplier.phone,
            address: supplier.address,
            notes: supplier.notes,
            isActive: supplier.is_active,
          }))}
          purchaseOrders={purchaseOrderHistory}
          receipts={recentGoodsReceipts}
          currencyCode={context.organization.currency_code}
          canViewCosts={canViewCosts}
          adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name }))}
          initialReceiptOrderId={requestedPurchaseOrderId}
          initialPurchasingSection={activeTab === "receiving" ? "receiving" : activeTab === "suppliers" ? "suppliers" : "orders"}
          receivingHref={purchasingTabHref("receiving")}
          showPurchasingTabs={false}
          sections={["purchasing"]}
          />
      ) : null}

      {activeTab === "supplier-returns" && canManage ? (
        <InventoryIntegrityWorkflows
          stores={stores.map(({ id, name }) => ({ id, name }))}
          items={advancedItems}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
          policies={policiesByStore}
          organizationDefaultPolicy={organizationDefaultPolicy}
          canManageOrganizationDefault={canManageOrganizationDefault}
          adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
          inTransitTransfers={inTransitTransfers}
          composites={compositeProducts}
          sections={["supplier-returns"]}
        />
      ) : null}

      {activeTab === "adjustments" && canManage ? (
        <InventoryIntegrityWorkflows
          stores={stores.map(({ id, name }) => ({ id, name }))}
          items={advancedItems}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
          policies={policiesByStore}
          organizationDefaultPolicy={organizationDefaultPolicy}
          canManageOrganizationDefault={canManageOrganizationDefault}
          adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
          inTransitTransfers={inTransitTransfers}
          composites={compositeProducts}
          sections={["adjustments"]}
        />
      ) : null}

      {activeTab === "counts" && canCount ? (
        <>
          <InventoryCountWorkspace
            documents={inventoryCountDocuments}
            categories={categories.filter((category) => !category.is_archived).map(({ id, name }) => ({ id, name }))}
            items={advancedItems.map(({ barcode, categoryId, categoryName, productId, quantitiesByStore, sku, storeIds, variantId, label, unit }) => ({
              barcode,
              categoryId,
              categoryName,
              productId,
              quantitiesByStore,
              sku,
              storeIds,
              variantId,
              label,
              unit,
            }))}
            stores={stores.map(({ id, name }) => ({ id, name }))}
            suppliers={countSuppliers}
          />
          {/* CANDIDATE_FOR_REMOVAL: the previous one-step count form remains for source compatibility but is no longer mounted. The document workspace preserves drafts and server-reviewed posting. */}
          {false ? <>
        <AdvancedInventoryWorkflows
          stores={stores.map(({ id, name }) => ({ id, name }))}
          items={advancedItems}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, contactName: supplier.contact_name, email: supplier.email, phone: supplier.phone, address: supplier.address, notes: supplier.notes, isActive: supplier.is_active }))}
          purchaseOrders={receivableOrders}
          currencyCode={context.organization.currency_code}
          adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name }))}
          sections={["counts"]}
        />
        <Card>
          <CardHeader>
            <CardTitle>Recent count records</CardTitle>
            <CardDescription>A completed count keeps both the expected and counted quantities. If they differ, TINDIO records the correction in stock activity.</CardDescription>
          </CardHeader>
          <CardContent>
            {inventoryCounts.length ? <div className="divide-y rounded-xl border">{inventoryCounts.map((count) => <article className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4" key={count.id}><div><p className="font-medium">Count #{count.count_number} · {storeNames.get(count.store_id) ?? "Inactive store"}</p><p className="mt-1 text-xs text-muted-foreground">{count.note || "No count note"}</p></div><div className="text-sm text-muted-foreground"><p className="capitalize">{count.status === "posted" ? "Posted" : count.status}</p><p className="mt-1 text-xs">{formatDate(count.completed_at ?? count.started_at)}</p></div></article>)}</div> : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No posted inventory counts are available in this store scope yet.</p>}
          </CardContent>
        </Card>
          </> : null}
        </>
      ) : null}

      {activeTab === "transfers" && canManage ? (
        <>
          <InventoryTransferWorkspace
            awaitingReceiptCount={inTransitTransfers.length}
            replenishmentHref={`/back-office/replenishment?tab=requests${storeScope.selectedStoreId ? `&store=${storeScope.selectedStoreId}` : ""}`}
          />
          <InventoryIntegrityWorkflows
            stores={stores.map(({ id, name }) => ({ id, name }))}
            items={advancedItems}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
            policies={policiesByStore}
            organizationDefaultPolicy={organizationDefaultPolicy}
            canManageOrganizationDefault={canManageOrganizationDefault}
            adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
            inTransitTransfers={inTransitTransfers}
            composites={compositeProducts}
            sections={["transfer-receipt"]}
          />
        </>
      ) : null}

      {activeTab === "production" && canManage && context.features.production ? (
        <InventoryIntegrityWorkflows
          stores={stores.map(({ id, name }) => ({ id, name }))}
          items={advancedItems}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
          policies={policiesByStore}
          organizationDefaultPolicy={organizationDefaultPolicy}
          canManageOrganizationDefault={canManageOrganizationDefault}
          adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
          inTransitTransfers={inTransitTransfers}
          composites={compositeProducts}
          sections={["production"]}
        />
      ) : null}

      {activeTab === "valuation" && canViewCosts ? (
        <InventoryValuationSummary
          currencyCode={context.organization.currency_code}
          entries={inventoryValuation.map((entry) => ({
            averageCostMinor: Number(entry.average_cost_minor),
            quantity: Number(entry.quantity),
            storeName: storeNames.get(entry.store_id) ?? "Unavailable store",
          }))}
        />
      ) : activeTab === "valuation" ? (
        <BackOfficeStateCard
          description="Cost and valuation data stays restricted to employees with the existing cost-view permission."
          icon={<Warehouse className="size-5" aria-hidden="true" />}
          title="Inventory valuation access required"
        />
      ) : null}

      {activeTab === "activity" ? (
        <>
          <InventoryProductDetail detail={inventoryDetail} />
          {/* CANDIDATE_FOR_REMOVAL: retained legacy stock-card renderer pending Stock & Restock visual QA. */}
          {false ? <section className="space-y-3" aria-labelledby="stock-levels-title">
        <div>
          <h2 className="text-lg font-semibold" id="stock-levels-title">
            Current stock
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One projected balance per store and saleable item.
          </p>
        </div>

        {levels.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {levels.map((level) => {
              const product = productById.get(level.product_id);
              const variant = level.variant_id ? variantById.get(level.variant_id) : undefined;
              const quantity = Number(level.quantity);
              const averageCostMinor = averageCostByStockLevel.get(
                `${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`,
              ) ?? 0;
              const isAvailable = availability.get(
                `${level.product_id}|${level.store_id}`,
              );

              if (!product || !storeNames.has(level.store_id)) return null;

              return (
                <Card key={level.id} size="sm">
                  <CardHeader className="flex-row items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                        <Boxes className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <CardTitle className="truncate">
                          {product.name}
                          {variant ? ` / ${variant.name}` : ""}
                        </CardTitle>
                        <CardDescription className="mt-1 truncate">
                          {storeNames.get(level.store_id)}
                        </CardDescription>
                      </div>
                    </div>
                    <Badge variant={isAvailable ? "secondary" : "outline"}>
                      {isAvailable ? "Available" : "Off"}
                    </Badge>
                  </CardHeader>
                  <CardContent className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-3xl font-semibold tracking-tight">
                        {formatQuantity(quantity)}
                      </p>
                      <p className="text-xs text-muted-foreground">{product.unit}</p>
                      {canViewCosts ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Avg. cost {formatMoney(averageCostMinor, context.organization.currency_code)} · Value {formatMoney(quantity * averageCostMinor, context.organization.currency_code)}
                        </p>
                      ) : null}
                    </div>
                    <p className="text-right text-xs text-muted-foreground">
                      Updated<br />
                      {formatDate(level.updated_at)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <BackOfficeStateCard
            description="Inventory levels appear when a tracked product is assigned to a store."
            icon={<PackageOpen className="size-5" aria-hidden="true" />}
            title="No stock levels yet"
          />
        )}
          </section> : null}

          {activeTab === "activity" ? (
            <section className="space-y-3" aria-labelledby="movement-history-title">
          <div>
            <h2 className="text-lg font-semibold" id="movement-history-title">
              {activityItemLabel ? `Activity for ${activityItemLabel}` : "Recent movements"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {activityItemLabel ? "The latest 50 append-only records for this item. History is never edited here." : "The newest 30 append-only stock records."}
            </p>
          </div>

          {!selectedDetailLevel ? (
            <form action="/back-office/inventory" className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3" method="get">
              <input name="tab" type="hidden" value="activity" />
              <label className="grid gap-1 text-sm font-medium"><span>From</span><input className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" defaultValue={activityFrom ?? ""} name="from" type="date" /></label>
              <label className="grid gap-1 text-sm font-medium"><span>To</span><input className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" defaultValue={activityTo ?? ""} name="to" type="date" /></label>
              <label className="grid gap-1 text-sm font-medium"><span>Store</span><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" defaultValue={storeScope.selectedStoreId ?? ""} name="store"><option value="">All authorized stores</option>{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
              <label className="grid gap-1 text-sm font-medium"><span>Document type</span><select className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" defaultValue={activityMovementType ?? ""} name="movementType"><option value="">All activity</option>{MOVEMENT_TYPES.map((movementType) => <option key={movementType} value={movementType}>{movementType.replaceAll("_", " ")}</option>)}</select></label>
              <button className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground" type="submit">Apply</button>
            </form>
          ) : null}

          {activityRows.length > 0 ? (
            <>
              <InventoryActivityList currencyCode={context.organization.currency_code} rows={activityRows} />
              {/* CANDIDATE_FOR_REMOVAL: retained legacy movement-card renderer until the shared activity drawer completes visual QA. */}
              {false ? <Card>
              <CardContent className="divide-y px-0">
                {activityMovements.map((movement) => {
                  const product = productById.get(movement.product_id);
                  const variant = movement.variant_id
                    ? variantById.get(movement.variant_id)
                    : undefined;
                  const delta = Number(movement.quantity_delta);
                  const movementCost = movementCostById.get(movement.id);
                  const DeltaIcon = delta > 0 ? ArrowUp : ArrowDown;
                  const activityActorName = selectedDetailLevel
                    ? actorNames.get(movement.actor_employee_id) ?? null
                    : null;
                  const activityReceipt = selectedDetailLevel && movement.source_id
                    ? receiptBySaleId.get(movement.source_id)
                    : undefined;
                  const activityReferenceLabel = activityReceipt
                    ? `Receipt ${activityReceipt.receipt_number}`
                    : selectedDetailLevel
                      ? formatInventorySourceReference(movement.source_type)
                      : null;

                  return (
                    <article
                      className="grid gap-3 px-4 py-4 sm:grid-cols-[auto_1fr_auto] sm:items-center"
                      key={movement.id}
                    >
                      <span
                        className={
                          delta > 0
                            ? "grid size-9 place-items-center rounded-full bg-primary/10 text-primary"
                            : "grid size-9 place-items-center rounded-full bg-destructive/10 text-destructive"
                        }
                      >
                        <DeltaIcon className="size-4" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium">
                          {product?.name || "Unavailable product"}
                          {variant ? ` / ${variant.name}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {storeNames.get(movement.store_id) || "Inactive store"} · {movement.movement_type.replaceAll("_", " ")} · {movement.reason_code ?? movement.reason}
                        </p>
                        {selectedDetailLevel ? <p className="mt-1 text-xs text-muted-foreground">{activityActorName ? `By ${activityActorName}` : "Employee details are restricted"}{activityReceipt ? <><span aria-hidden="true"> · </span><Link className="text-primary hover:underline" href={`/back-office/receipts/${activityReceipt.id}`}>{activityReferenceLabel}</Link></> : activityReferenceLabel ? <><span aria-hidden="true"> · </span>{activityReferenceLabel}</> : null}</p> : null}
                      </div>
                      <div className="text-left sm:text-right">
                        <p className={delta > 0 ? "font-semibold text-primary" : "font-semibold text-destructive"}>
                          {delta > 0 ? "+" : ""}{formatQuantity(delta)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatQuantity(Number(movement.quantity_before))} → {formatQuantity(Number(movement.quantity_after))} · {formatDate(movement.created_at)}
                        </p>
                        {canViewCosts && movementCost ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatMoney(movementCost.valueDeltaMinor, context.organization.currency_code)} value change · {formatMoney(movementCost.unitCostMinor, context.organization.currency_code)} unit cost
                          </p>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </CardContent>
              </Card> : null}
            </>
          ) : (
            <BackOfficeStateCard
              description="Opening stock and adjustments will be listed here."
              icon={<Warehouse className="size-5" aria-hidden="true" />}
              title="No movements recorded"
            />
          )}
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function InventoryValuationSummary({
  currencyCode,
  entries,
}: {
  currencyCode: string;
  entries: Array<{ averageCostMinor: number; quantity: number; storeName: string }>;
}) {
  const completeEntries = entries.filter((entry) => entry.averageCostMinor > 0);
  const missingCostEntries = entries.filter((entry) => entry.quantity !== 0 && entry.averageCostMinor === 0);
  const totalValueMinor = completeEntries.reduce(
    (total, entry) => total + entry.quantity * entry.averageCostMinor,
    0,
  );

  return (
    <section aria-labelledby="inventory-valuation-title" className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold" id="inventory-valuation-title">Inventory valuation</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Valuation uses recorded average cost. Positions with a zero recorded cost are kept separate so they are not silently treated as confirmed zero-value stock.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Recorded value</p><p className="mt-1 text-2xl font-semibold">{formatMoney(totalValueMinor, currencyCode)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Costed positions</p><p className="mt-1 text-2xl font-semibold">{completeEntries.length}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Missing cost</p><p className="mt-1 text-2xl font-semibold">{missingCostEntries.length}</p></CardContent></Card>
      </div>
      {missingCostEntries.length ? (
        <Card>
          <CardContent className="p-4 text-sm text-muted-foreground">
            {missingCostEntries.length} stock position{missingCostEntries.length === 1 ? " has" : "s have"} a zero recorded cost and {missingCostEntries.length === 1 ? "is" : "are"} excluded from the confirmed valuation. Review its acquisition cost before relying on this total.
          </CardContent>
        </Card>
      ) : null}
    </section>
  );
}

/** CANDIDATE_FOR_REMOVAL: retained while the Phase 4 control-tower metrics complete visual QA. */
export function InventoryMetricCard({
  href,
  label,
  detail,
  value,
}: {
  href: string;
  label: string;
  detail: string;
  value: number;
}) {
  return (
    <Link className="block rounded-xl focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" href={href}>
      <Card className="h-full transition-colors hover:border-primary/40 hover:bg-secondary/20">
        <CardContent className="space-y-1 p-4">
          <p className="text-sm font-medium">{label}</p>
          <p className="text-3xl font-semibold tracking-tight">{formatQuantity(value)}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-PH", {
    maximumFractionDigits: 3,
  }).format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatMoney(valueMinor: number, currencyCode: string) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: currencyCode,
  }).format(valueMinor / 100);
}

function formatInventorySourceReference(sourceType: string | null) {
  if (!sourceType) return null;

  const labels: Record<string, string> = {
    composite_sale: "Sale reference",
    goods_receipt: "Receiving reference",
    inventory_adjustment: "Adjustment reference",
    inventory_count: "Count reference",
    production_run: "Production reference",
    refund: "Refund reference",
    sale: "Sale reference",
    stock_transfer: "Transfer reference",
    supplier_return: "Supplier return reference",
  };

  return labels[sourceType] ?? `${sourceType.replaceAll("_", " ")} reference`;
}
