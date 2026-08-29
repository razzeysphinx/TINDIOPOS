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
import {
  InventoryAdjustmentForm,
  type InventorySaleableItem,
} from "@/features/catalog/catalog-forms";
import { DashboardActionGrid } from "@/features/dashboard/dashboard-action-grid";
import {
  AdvancedInventoryWorkflows,
  type AdvancedPurchaseOrder,
} from "@/features/inventory/advanced-inventory-workflows";
import { InventoryIntegrityWorkflows } from "@/features/inventory/inventory-integrity-workflows";
import {
  InventoryStockView,
  type InventoryStockStatus,
} from "@/features/inventory/inventory-stock-view";
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

function InventoryTabs({ activeTab, storeId }: { activeTab: InventoryTab; storeId: string | null }) {
  return (
    <nav aria-label="Inventory sections" className="overflow-x-auto border-b">
      <div className="flex min-w-max gap-1">
        {INVENTORY_TABS.map((tab) => {
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
  searchParams: Promise<{ status?: string | string[]; store?: string; tab?: string | string[] }>;
}) {
  const context = await requireBackOfficePermission("inventory.manage");
  const parameters = await searchParams;
  const activeTab = resolveInventoryTab(parameters.tab);
  const initialStockStatus = resolveInventoryStockStatus(parameters.status);
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
  const canManage = hasPermission(context, "inventory.manage");
  const canViewCosts = hasPermission(context, "products.view_cost");
  const selectedStoreId = storeScope.selectedStoreId;
  const settingsQuery = supabase
    .from("product_store_settings")
    .select("product_id, store_id, is_available")
    .eq("organization_id", organizationId);
  const levelsQuery = supabase
    .from("inventory_levels")
    .select("id, store_id, product_id, variant_id, quantity, average_cost_minor, updated_at")
    .eq("organization_id", organizationId);
  const replenishmentRulesQuery = canManage
    ? supabase
        .from("inventory_replenishment_rules")
        .select("store_id, product_id, variant_id, reorder_point")
        .eq("organization_id", organizationId)
    : null;

  if (selectedStoreId) {
    settingsQuery.eq("store_id", selectedStoreId);
    levelsQuery.eq("store_id", selectedStoreId);
    replenishmentRulesQuery?.eq("store_id", selectedStoreId);
  }

  const [
    storesResult,
    categoriesResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    movementsResult,
    suppliersResult,
    purchaseOrdersResult,
    purchaseOrderLinesResult,
    inventoryPoliciesResult,
    adjustmentReasonsResult,
    stockTransfersResult,
    stockTransferLinesResult,
    replenishmentRulesResult,
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
    canManage
      ? supabase
          .from("inventory_movements")
          .select(
            "id, store_id, product_id, variant_id, quantity_delta, quantity_before, quantity_after, movement_type, actor_employee_id, reason, reason_code, unit_cost_minor, value_delta_minor, created_at",
          )
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({
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
              | "unit_cost_minor"
              | "value_delta_minor"
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
    canManage
      ? supabase
          .from("purchase_orders")
          .select("id, supplier_id, store_id, order_number, status, expected_at, created_at")
          .eq("organization_id", organizationId)
          .in("status", ["ordered", "partially_received"])
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("purchase_order_lines")
          .select(
            "id, purchase_order_id, product_id, variant_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, ordered_quantity, received_quantity, unit_cost_minor",
          )
          .eq("organization_id", organizationId)
      : Promise.resolve({ data: [], error: null }),
    canManage
      ? supabase
          .from("inventory_policies")
          .select("store_id, negative_stock_policy")
          .eq("organization_id", organizationId)
      : Promise.resolve({ data: [], error: null }),
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
  ]);

  const error = [
    storesResult,
    categoriesResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    movementsResult,
    suppliersResult,
    purchaseOrdersResult,
    purchaseOrderLinesResult,
    inventoryPoliciesResult,
    adjustmentReasonsResult,
    stockTransfersResult,
    stockTransferLinesResult,
    replenishmentRulesResult,
  ].find((result) => result.error)?.error;

  if (error) {
    throw new Error(`Unable to load inventory: ${error.message}`);
  }

  const visibleStore = (storeId: string) => !storeScope.selectedStoreId || storeId === storeScope.selectedStoreId;
  const stores = (storesResult.data ?? []).filter((store) => visibleStore(store.id));
  const categories = categoriesResult.data ?? [];
  const products = productsResult.data ?? [];
  const variants = variantsResult.data ?? [];
  const settings = (settingsResult.data ?? []).filter((setting) => visibleStore(setting.store_id));
  const levels = (levelsResult.data ?? []).filter((level) => visibleStore(level.store_id));
  const movements = (movementsResult.data ?? []).filter((movement) => visibleStore(movement.store_id));
  const suppliers = suppliersResult.data ?? [];
  const purchaseOrders = (purchaseOrdersResult.data ?? []).filter((order) => visibleStore(order.store_id));
  const purchaseOrderLines = purchaseOrderLinesResult.data ?? [];
  const inventoryPolicies = (inventoryPoliciesResult.data ?? []).filter((policy) => visibleStore(policy.store_id));
  const adjustmentReasons = adjustmentReasonsResult.data ?? [];
  const stockTransfers = (stockTransfersResult.data ?? []).filter((transfer) => visibleStore(transfer.source_store_id) || visibleStore(transfer.destination_store_id));
  const stockTransferLines = stockTransferLinesResult.data ?? [];
  const replenishmentRules = (replenishmentRulesResult.data ?? []).filter((rule) => visibleStore(rule.store_id));
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

  const receivableOrders: AdvancedPurchaseOrder[] = purchaseOrders
    .map((order) => ({
      id: order.id,
      orderNumber: Number(order.order_number),
      status: order.status as "ordered" | "partially_received",
      supplierName: supplierNames.get(order.supplier_id) ?? "Unavailable supplier",
      storeName: storeNames.get(order.store_id) ?? "Inactive store",
      expectedAt: order.expected_at,
      createdAt: order.created_at,
      lines: (purchaseOrderLinesByOrder.get(order.id) ?? [])
        .filter((line) => Number(line.received_quantity) < Number(line.ordered_quantity))
        .map((line) => ({
          id: line.id,
          label: `${line.product_name_snapshot}${line.variant_name_snapshot ? ` / ${line.variant_name_snapshot}` : ""}`,
          unit: line.unit_snapshot,
          orderedQuantity: Number(line.ordered_quantity),
          receivedQuantity: Number(line.received_quantity),
          unitCostMinor: Number(line.unit_cost_minor),
        })),
    }))
    .filter((order) => order.lines.length > 0);
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
  const stockRows = levels.flatMap((level) => {
    const product = productById.get(level.product_id);
    const variant = level.variant_id ? variantById.get(level.variant_id) : undefined;
    const storeName = storeNames.get(level.store_id);

    if (!product || !storeName) return [];

    return [{
      averageCostMinor: canViewCosts ? Number(level.average_cost_minor) : null,
      barcode: variant?.barcode ?? product.barcode,
      categoryId: product.category_id,
      categoryName: product.category_id ? categoryNames.get(product.category_id) ?? "Uncategorized" : "Uncategorized",
      id: level.id,
      isAvailable: availability.get(`${level.product_id}|${level.store_id}`) === true,
      productName: product.name,
      quantity: Number(level.quantity),
      reorderPoint: canManage ? reorderPoints.get(`${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`) ?? null : null,
      sku: variant?.sku ?? product.sku,
      storeId: level.store_id,
      storeName,
      unit: product.unit,
      updatedAt: level.updated_at,
      variantName: variant?.name ?? null,
    }];
  });

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

      <InventoryTabs activeTab={activeTab} storeId={storeScope.selectedStoreId} />

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
        <details className="group rounded-xl border bg-card">
          <summary className="cursor-pointer list-none px-5 py-4 font-medium marker:hidden">
            More inventory operations
            <span className="ml-2 text-sm font-normal text-muted-foreground">Adjustments, safeguards, and production</span>
          </summary>
          <div className="space-y-6 border-t p-5">
            <InventoryAdjustmentForm
              items={items}
              stores={stores.map(({ id, name }) => ({ id, name }))}
            />
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
          purchaseOrders={receivableOrders}
          currencyCode={context.organization.currency_code}
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
        <AdvancedInventoryWorkflows
          stores={stores.map(({ id, name }) => ({ id, name }))}
          items={advancedItems}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, contactName: supplier.contact_name, email: supplier.email, phone: supplier.phone, address: supplier.address, notes: supplier.notes, isActive: supplier.is_active }))}
          purchaseOrders={receivableOrders}
          currencyCode={context.organization.currency_code}
          adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name }))}
          sections={["counts"]}
        />
      ) : null}

      {activeTab === "transfers" && canManage ? (
        <>
          <AdvancedInventoryWorkflows
            stores={stores.map(({ id, name }) => ({ id, name }))}
            items={advancedItems}
            suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, contactName: supplier.contact_name, email: supplier.email, phone: supplier.phone, address: supplier.address, notes: supplier.notes, isActive: supplier.is_active }))}
            purchaseOrders={receivableOrders}
            currencyCode={context.organization.currency_code}
            adjustmentReasons={adjustmentReasons.map((reason) => ({ code: reason.code, name: reason.name }))}
            sections={["transfers"]}
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
          {activeTab === "stock" ? <InventoryStockView canUseReorderStatus={canManage} canViewCosts={canViewCosts} currencyCode={context.organization.currency_code} initialStatus={initialStockStatus} preferenceScope={organizationId} rows={stockRows} /> : null}
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
              const averageCostMinor = Number(level.average_cost_minor);
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

          {activeTab === "activity" && canManage ? (
            <section className="space-y-3" aria-labelledby="movement-history-title">
          <div>
            <h2 className="text-lg font-semibold" id="movement-history-title">
              Recent movements
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The newest 30 append-only stock records.
            </p>
          </div>

          {movements.length > 0 ? (
            <Card>
              <CardContent className="divide-y px-0">
                {movements.map((movement) => {
                  const product = productById.get(movement.product_id);
                  const variant = movement.variant_id
                    ? variantById.get(movement.variant_id)
                    : undefined;
                  const delta = Number(movement.quantity_delta);
                  const DeltaIcon = delta > 0 ? ArrowUp : ArrowDown;

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
                      </div>
                      <div className="text-left sm:text-right">
                        <p className={delta > 0 ? "font-semibold text-primary" : "font-semibold text-destructive"}>
                          {delta > 0 ? "+" : ""}{formatQuantity(delta)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatQuantity(Number(movement.quantity_before))} → {formatQuantity(Number(movement.quantity_after))} · {formatDate(movement.created_at)}
                        </p>
                        {canViewCosts ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatMoney(Number(movement.value_delta_minor), context.organization.currency_code)} value change · {formatMoney(Number(movement.unit_cost_minor), context.organization.currency_code)} unit cost
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
