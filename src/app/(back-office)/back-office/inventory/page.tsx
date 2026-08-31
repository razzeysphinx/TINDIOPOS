import { ArrowDown, ArrowUp, Boxes, PackageOpen, Warehouse } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
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
import {
  InventoryProductDetail,
  type InventoryProductDetailData,
} from "@/features/inventory/inventory-product-detail";
import {
  InventoryStockView,
  type InventoryStockStatus,
} from "@/features/inventory/inventory-stock-view";
import { getInventoryStockCondition } from "@/features/inventory/inventory-stock-status";
import { InventoryTransferWorkspace } from "@/features/inventory/inventory-transfer-workspace";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import type { TableRow } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Inventory" };

const INVENTORY_TABS = [
  { id: "overview", label: "Overview" },
  { id: "stock", label: "Stock" },
  { id: "activity", label: "Activity" },
  { id: "counts", label: "Counts" },
  { id: "purchasing", label: "Purchasing" },
  { id: "transfers", label: "Transfers" },
] as const;

type InventoryTab = (typeof INVENTORY_TABS)[number]["id"];

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

function resolveInventoryTab(value: string | string[] | undefined): InventoryTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return INVENTORY_TABS.some((tab) => tab.id === candidate)
    ? candidate as InventoryTab
    : "overview";
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

function InventoryTabs({
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
    : INVENTORY_TABS.filter((tab) => tab.id === "stock" || tab.id === "activity");

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

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string | string[]; status?: string | string[]; store?: string; tab?: string | string[] }>;
}) {
  const context = await requireBackOfficePermission(["inventory.view", "inventory.manage"]);
  const parameters = await searchParams;
  const requestedTab = resolveInventoryTab(parameters.tab);
  const canManage = hasPermission(context, "inventory.manage");
  const activeTab = canManage || requestedTab === "stock" || requestedTab === "activity"
    ? requestedTab
    : "stock";
  const initialStockStatus = resolveInventoryStockStatus(parameters.status);
  const requestedDetailLevelId = resolveInventoryLevelId(parameters.detail);
  const selectedDetailLevelId = activeTab === "stock" || activeTab === "activity"
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
  const valuationQuery = canViewCosts
    ? supabase.rpc("get_inventory_valuation", { target_organization_id: organizationId })
    : Promise.resolve({ data: [], error: null });
  const replenishmentRulesQuery = canManage
    ? supabase
        .from("inventory_replenishment_rules")
        .select("store_id, product_id, variant_id, reorder_point")
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
  const recentMovementsQuery = activeTab === "activity"
    ? supabase
        .from("inventory_movements")
        .select(
          "id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after, movement_type, actor_employee_id, reason, reason_code, source_type, source_id, created_at",
        )
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(30)
    : null;
  const inventoryCountsQuery = canManage && activeTab === "counts"
    ? supabase
        .from("inventory_counts")
        .select("id, store_id, status, note, started_at, completed_at")
        .eq("organization_id", organizationId)
        .eq("status", "completed")
        .order("started_at", { ascending: false })
        .limit(25)
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
    adjustmentReasonsResult,
    stockTransfersResult,
    stockTransferLinesResult,
    replenishmentRulesResult,
    inventoryCountsResult,
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
          .select("id, name, contact_name, email, phone, address, notes, is_active")
          .eq("organization_id", organizationId)
          .order("name", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    purchaseOrdersQuery ?? Promise.resolve({ data: [], error: null }),
    inventoryPoliciesQuery ?? Promise.resolve({ data: [], error: null }),
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
      data: [] as Array<Pick<TableRow<"inventory_counts">, "id" | "store_id" | "status" | "note" | "started_at" | "completed_at">>,
      error: null,
    }),
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
    adjustmentReasonsResult,
    stockTransfersResult,
    stockTransferLinesResult,
    replenishmentRulesResult,
    inventoryCountsResult,
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
  const purchaseOrderIds = purchaseOrders.map((order) => order.id);
  const [purchaseOrderLinesResult, goodsReceiptsResult] = await Promise.all([
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
  ]);

  const purchasingError = [purchaseOrderLinesResult, goodsReceiptsResult].find((result) => result.error)?.error;
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
  const adjustmentReasons = adjustmentReasonsResult.data ?? [];
  const stockTransfers = (stockTransfersResult.data ?? []).filter((transfer) => visibleStore(transfer.source_store_id) || visibleStore(transfer.destination_store_id));
  const stockTransferLines = stockTransferLinesResult.data ?? [];
  const replenishmentRules = (replenishmentRulesResult.data ?? []).filter((rule) => visibleStore(rule.store_id));
  const inventoryCounts = (inventoryCountsResult.data ?? []).filter((count) => visibleStore(count.store_id));
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
  const actorEmployeeIds = [...new Set(detailMovements.map((movement) => movement.actor_employee_id))];
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

  const receiptSaleIds = [...new Set(detailMovements.flatMap((movement) => (
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
    identifiers: item.identifiers ?? [],
    unit: productById.get(item.productId)?.unit ?? "units",
    quantitiesByStore:
      quantitiesBySaleable.get(`${item.productId}|${item.variantId ?? ""}`) ?? {},
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
  const inventoryTabHref = (tab: InventoryTab, status?: InventoryStockStatus) =>
    `/back-office/inventory?tab=${tab}${storeScope.selectedStoreId ? `&store=${storeScope.selectedStoreId}` : ""}${status && status !== "all" ? `&status=${status}` : ""}`;
  const inventoryDetailHref = (tab: Extract<InventoryTab, "activity" | "stock">, levelId: string) =>
    `${inventoryTabHref(tab, tab === "stock" ? initialStockStatus : undefined)}&detail=${levelId}`;
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
      detailHref: inventoryDetailHref("stock", level.id),
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
  const selectedDetailProduct = selectedDetailLevel ? productById.get(selectedDetailLevel.product_id) : undefined;
  const selectedDetailVariant = selectedDetailLevel?.variant_id
    ? variantById.get(selectedDetailLevel.variant_id)
    : undefined;
  const inventoryDetail: InventoryProductDetailData | null = selectedDetailLevel && selectedDetailProduct
    ? {
        activity: detailMovements.map((movement) => {
          const receipt = movement.source_id ? receiptBySaleId.get(movement.source_id) : undefined;
          return {
            actorName: actorNames.get(movement.actor_employee_id) ?? null,
            createdAt: movement.created_at,
            id: movement.id,
            movementType: movement.movement_type,
            quantityAfter: Number(movement.quantity_after),
            quantityBefore: Number(movement.quantity_before),
            quantityDelta: Number(movement.quantity_delta),
            reason: movement.reason_code ?? movement.reason,
            referenceHref: receipt ? `/back-office/receipts/${receipt.id}` : null,
            referenceLabel: receipt ? `Receipt ${receipt.receipt_number}` : formatInventorySourceReference(movement.source_type),
            storeName: storeNames.get(movement.store_id) ?? "Unavailable store",
          };
        }),
        adjustmentHref: canManage ? `${inventoryTabHref("overview")}#inventory-operations` : null,
        barcode: selectedDetailVariant?.barcode ?? selectedDetailProduct.barcode,
        categoryName: selectedDetailProduct.category_id ? categoryNames.get(selectedDetailProduct.category_id) ?? "Uncategorized" : "Uncategorized",
        closeHref: inventoryTabHref("stock", initialStockStatus),
        condition: getInventoryStockCondition({
          quantity: Number(selectedDetailLevel.quantity),
          reorderPoint: reorderPoints.get(`${selectedDetailLevel.store_id}|${selectedDetailLevel.product_id}|${selectedDetailLevel.variant_id ?? ""}`) ?? null,
        }),
        fullActivityHref: inventoryDetailHref("activity", selectedDetailLevel.id),
        isAvailable: availability.get(`${selectedDetailLevel.product_id}|${selectedDetailLevel.store_id}`) === true,
        productName: selectedDetailProduct.name,
        purchasingHref: inventoryTabHref("purchasing"),
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
        variantName: selectedDetailVariant?.name ?? null,
      }
    : null;
  const activityMovements = selectedDetailLevel ? detailMovements : movements;
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Stock control"
        title="Inventory"
        description="Understand what you have, what needs attention, and the accountable activity behind every stock change."
        action={
          <Badge variant={canManage ? "secondary" : "outline"}>
            {canManage ? "Stock management" : "Level view"}
          </Badge>
        }
      />

      <GlobalFilterBar action="/back-office/inventory" hiddenFields={{ tab: activeTab, status: activeTab === "stock" && initialStockStatus !== "all" ? initialStockStatus : undefined }} namePrefix="inventory-filter" showDateRange={false} storeId={storeScope.selectedStoreId} stores={await loadAuthorizedBackOfficeStores(context)} />

      {activeTab === "overview" ? (
        <DashboardActionGrid
          inventoryEnabled={context.features.inventory}
          permissions={context.permissions}
          surface="inventory"
        />
      ) : null}

      <InventoryTabs activeTab={activeTab} canManage={canManage} storeId={storeScope.selectedStoreId} />

      {activeTab === "overview" ? (
        <section className="space-y-4" aria-labelledby="inventory-health-title">
          <div>
            <h2 className="text-lg font-semibold" id="inventory-health-title">Inventory health</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start with the items and operational work that need attention now.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InventoryMetricCard
              href={inventoryTabHref("stock")}
              label="Tracked items"
              detail="Available across the selected stores"
              value={items.length}
            />
            <InventoryMetricCard
              href={inventoryTabHref("stock", "attention")}
              label="Needs attention"
              detail={`${outOfStockCount} out of stock · ${negativeStockCount} negative`}
              value={needsAttentionCount}
            />
            <InventoryMetricCard
              href={inventoryTabHref("purchasing")}
              label="Awaiting receiving"
              detail="Open or partially received purchase orders"
              value={receivableOrders.length}
            />
            <InventoryMetricCard
              href={inventoryTabHref("transfers")}
              label="Transfers awaiting receipt"
              detail="Shipped stock not yet fully received"
              value={inTransitTransfers.length}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Simple first</CardTitle>
              <CardDescription>
                Use Stock for current balances, Activity for recent changes, and the operational tabs only when work needs to be done.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Link className="text-sm font-medium text-primary hover:underline" href={inventoryTabHref("stock")}>View stock</Link>
              <Link className="text-sm font-medium text-primary hover:underline" href={inventoryTabHref("activity")}>View activity</Link>
              <Link className="text-sm font-medium text-primary hover:underline" href="/back-office/replenishment">Open replenishment</Link>
            </CardContent>
          </Card>
        </section>
      ) : null}

      {activeTab === "overview" && canManage ? (
        <details className="group rounded-xl border bg-card" id="inventory-operations">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium marker:hidden">
            More inventory operations
            <span className="ml-2 text-sm font-normal text-muted-foreground">Adjustments, safeguards, and production</span>
          </summary>
          <div className="space-y-6 border-t p-5">
            {/* CANDIDATE_FOR_REMOVAL: the older approval-aware adjustment form remains in catalog-forms.tsx, but this page now exposes one controlled-reason adjustment workflow. */}
            <InventoryIntegrityWorkflows
              stores={stores.map(({ id, name }) => ({ id, name }))}
              items={advancedItems}
              suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
              policies={policiesByStore}
              adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
              inTransitTransfers={inTransitTransfers}
              composites={compositeProducts}
              sections={["safeguards", "adjustments", "production"]}
            />
          </div>
        </details>
      ) : null}

      {activeTab === "purchasing" && canManage ? (
        <>
          <AdvancedInventoryWorkflows
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
          sections={["purchasing"]}
          />
          <InventoryIntegrityWorkflows
            stores={stores.map(({ id, name }) => ({ id, name }))}
            items={advancedItems}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
            policies={policiesByStore}
            adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
            inTransitTransfers={inTransitTransfers}
            composites={compositeProducts}
            sections={["supplier-returns"]}
          />
        </>
      ) : null}

      {activeTab === "counts" && canManage ? (
        <>
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
            <CardDescription>Completed counts preserve their expected and counted quantities; any variance is posted through the immutable inventory ledger.</CardDescription>
          </CardHeader>
          <CardContent>
            {inventoryCounts.length ? <div className="divide-y rounded-xl border">{inventoryCounts.map((count) => <article className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4" key={count.id}><div><p className="font-medium">{storeNames.get(count.store_id) ?? "Inactive store"}</p><p className="mt-1 text-xs text-muted-foreground">{count.note || "No count note"}</p></div><div className="text-sm text-muted-foreground"><p className="capitalize">{count.status}</p><p className="mt-1 text-xs">{formatDate(count.completed_at ?? count.started_at)}</p></div></article>)}</div> : <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No completed inventory counts are available in this store scope yet.</p>}
          </CardContent>
        </Card>
        </>
      ) : null}

      {activeTab === "transfers" && canManage ? (
        <>
          <InventoryTransferWorkspace
            awaitingReceiptCount={inTransitTransfers.length}
            replenishmentHref={`/back-office/replenishment${storeScope.selectedStoreId ? `?store=${storeScope.selectedStoreId}` : ""}`}
          />
          <InventoryIntegrityWorkflows
            stores={stores.map(({ id, name }) => ({ id, name }))}
            items={advancedItems}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, isActive: supplier.is_active }))}
            policies={policiesByStore}
            adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name, movementType: reason.movement_type as "ADJUSTMENT" | "DAMAGE" | "LOSS" }))}
            inTransitTransfers={inTransitTransfers}
            composites={compositeProducts}
            sections={["transfer-receipt"]}
          />
        </>
      ) : null}

      {(activeTab === "stock" || activeTab === "activity") ? (
        <>
          {activeTab === "stock" ? <><InventoryStockView canUseReorderStatus={canManage} canViewCosts={canViewCosts} currencyCode={context.organization.currency_code} initialStatus={initialStockStatus} multiStoreCount={stores.length} preferenceScope={organizationId} rows={stockRows} /><InventoryProductDetail detail={inventoryDetail} /></> : null}
          {/* CANDIDATE_FOR_REMOVAL: retained legacy stock-card renderer pending Phase 2 visual QA. */}
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

          {activityMovements.length > 0 ? (
            <Card>
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
            </Card>
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

function InventoryMetricCard({
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
