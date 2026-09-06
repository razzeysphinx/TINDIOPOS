import { PackageSearch } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SupplyChainWorkflows,
  type InboundPurchaseOrder,
  type ReplenishmentRule,
  type SupplyChainItem,
  type SupplyChainRequest,
} from "@/features/inventory/supply-chain-workflows";
import {
  InventoryStockView,
  type InventoryStockStatus,
} from "@/features/inventory/inventory-stock-view";
import {
  InventoryWorkspaceNavigation,
  type StockRestockTab,
} from "@/features/inventory/inventory-workspace-navigation";
import { resolveBackOfficeStoreScope } from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Stock & Restock" };

const STOCK_RESTOCK_TABS: readonly StockRestockTab[] = ["levels", "needs-restocking", "requests"];

function resolveStockRestockTab(value: string | string[] | undefined): StockRestockTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  return STOCK_RESTOCK_TABS.includes(candidate as StockRestockTab) ? candidate as StockRestockTab : "levels";
}

function resolveStockStatus(value: string | string[] | undefined): InventoryStockStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  const allowed: readonly InventoryStockStatus[] = ["all", "attention", "available", "in_stock", "low", "negative", "out_of_stock"];
  return allowed.includes(candidate as InventoryStockStatus) ? candidate as InventoryStockStatus : "all";
}

export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<{ detail?: string; status?: string | string[]; store?: string; tab?: string | string[] }>;
}) {
  const context = await requireBackOfficePermission(["inventory.view", "inventory.manage"]);
  const parameters = await searchParams;
  const activeTab = resolveStockRestockTab(parameters.tab);
  const initialStockStatus = resolveStockStatus(parameters.status);
  const canManage = hasPermission(context, "inventory.manage");
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();

  if (!context.features.inventory) {
    return <FeatureState title="Restock items is unavailable" description="An owner or administrator can enable Inventory in Business profile & features." />;
  }

  if (!canManage && activeTab !== "levels") {
    return <FeatureState title="Restock items access required" description="Your role needs inventory-management access to manage warehouses and stock requests." />;
  }

  const supabase = await createClient();
  const organizationId = context.organization.id;
  const canViewCosts = hasPermission(context, "products.view_cost");
  const [
    storesResult,
    categoriesResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    warehousesResult,
    rulesResult,
    requestsResult,
    suppliersResult,
    purchaseOrdersResult,
    valuationResult,
    archivedProductsResult,
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("organization_id", organizationId).eq("is_active", true).order("created_at"),
    supabase.from("categories").select("id, name").eq("organization_id", organizationId).eq("is_archived", false).order("name"),
    supabase.from("products").select("id, category_id, name, sku, barcode, product_type, unit, status, track_inventory").eq("organization_id", organizationId).eq("status", "active").eq("track_inventory", true).order("name"),
    supabase.from("product_variants").select("id, product_id, name, sku, barcode, sort_order").eq("organization_id", organizationId).eq("is_active", true).order("sort_order"),
    supabase.from("product_store_settings").select("product_id, store_id, is_available, restock_policy").eq("organization_id", organizationId),
    supabase.from("inventory_levels").select("id, store_id, product_id, variant_id, quantity, updated_at").eq("organization_id", organizationId),
    supabase.from("supply_chain_warehouses").select("id, store_id, code, name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("inventory_replenishment_rules").select("id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock").eq("organization_id", organizationId).order("updated_at", { ascending: false }),
    supabase.from("stock_requests").select("id, request_number, requesting_store_id, source_warehouse_id, status, note, requested_at, approved_at, picked_at, dispatched_at, received_at, updated_at").eq("organization_id", organizationId).order("requested_at", { ascending: false }).limit(30),
    supabase.from("suppliers").select("id, name, lead_time_days").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("purchase_orders").select("id, order_number, supplier_id, store_id, status, expected_at").eq("organization_id", organizationId).in("status", ["ordered", "partially_received"]).order("created_at", { ascending: false }).limit(20),
    canViewCosts ? supabase.rpc("get_inventory_valuation", { target_organization_id: organizationId }) : Promise.resolve({ data: [], error: null }),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "archived"),
  ]);

  const firstError = [storesResult, categoriesResult, productsResult, variantsResult, settingsResult, levelsResult, warehousesResult, rulesResult, requestsResult, suppliersResult, purchaseOrdersResult, valuationResult, archivedProductsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(`Unable to load replenishment: ${firstError.message}`);

  const visibleStore = (storeId: string) => !storeScope.selectedStoreId || storeId === storeScope.selectedStoreId;
  // The filter narrows recommendations and history. Keep all RLS-authorized stock locations available so a selected destination store can still request from another authorized warehouse.
  const stores = storesResult.data ?? [];
  const categories = categoriesResult.data ?? [];
  const products = productsResult.data ?? [];
  const variants = variantsResult.data ?? [];
  const settings = settingsResult.data ?? [];
  const levels = levelsResult.data ?? [];
  const stockLevels = levels.filter((level) => visibleStore(level.store_id));
  const warehouses = warehousesResult.data ?? [];
  const rules = (rulesResult.data ?? []).filter((rule) => visibleStore(rule.store_id));
  const requests = (requestsResult.data ?? []).filter((request) => visibleStore(request.requesting_store_id));
  const suppliers = suppliersResult.data ?? [];
  const purchaseOrders = (purchaseOrdersResult.data ?? []).filter((order) => visibleStore(order.store_id));
  const requestIds = requests.map((request) => request.id);
  const purchaseOrderIds = purchaseOrders.map((order) => order.id);

  const [requestLinesResult, stockTransfersResult, openStockTransfersResult, purchaseOrderLinesResult, discrepanciesResult] = await Promise.all([
    requestIds.length
      ? supabase.from("stock_request_lines").select("id, stock_request_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, requested_quantity, approved_quantity, picked_quantity, dispatched_quantity, received_quantity, short_quantity").eq("organization_id", organizationId).in("stock_request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? supabase.from("stock_transfers").select("id, stock_request_id, destination_store_id, status, transfer_number").eq("organization_id", organizationId).in("stock_request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("stock_transfers").select("id, stock_request_id, destination_store_id, status, transfer_number").eq("organization_id", organizationId).in("status", ["in_transit", "partially_received"]),
    purchaseOrderIds.length
      ? supabase.from("purchase_order_lines").select("purchase_order_id, ordered_quantity, received_quantity").eq("organization_id", organizationId).in("purchase_order_id", purchaseOrderIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? supabase.from("stock_request_discrepancies").select("stock_request_id, stock_request_line_id, short_quantity, note, reported_at").eq("organization_id", organizationId).in("stock_request_id", requestIds).order("reported_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);
  const secondError = [requestLinesResult, stockTransfersResult, openStockTransfersResult, purchaseOrderLinesResult, discrepanciesResult].find((result) => result.error)?.error;
  if (secondError) throw new Error(`Unable to load replenishment details: ${secondError.message}`);

  const stockTransfers = stockTransfersResult.data ?? [];
  const allRelevantTransfers = Array.from(new Map(
    [...stockTransfers, ...(openStockTransfersResult.data ?? [])].map((transfer) => [transfer.id, transfer]),
  ).values());
  const stockTransferIds = allRelevantTransfers.map((transfer) => transfer.id);
  const stockTransferLinesResult = stockTransferIds.length
    ? await supabase.from("stock_transfer_lines").select("id, stock_transfer_id, stock_request_line_id, product_id, variant_id, quantity, received_quantity, short_quantity").eq("organization_id", organizationId).in("stock_transfer_id", stockTransferIds)
    : { data: [], error: null };
  if (stockTransferLinesResult.error) throw new Error(`Unable to load transfer receiving details: ${stockTransferLinesResult.error.message}`);

  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const quantitiesBySaleable = new Map<string, Record<string, number>>();
  for (const level of levels) {
    const key = `${level.product_id}|${level.variant_id ?? ""}`;
    const quantities = quantitiesBySaleable.get(key) ?? {};
    quantities[level.store_id] = Number(level.quantity);
    quantitiesBySaleable.set(key, quantities);
  }
  const inTransitBySaleable = new Map<string, Record<string, number>>();
  const openTransferById = new Map((openStockTransfersResult.data ?? []).map((transfer) => [transfer.id, transfer]));
  for (const line of stockTransferLinesResult.data ?? []) {
    const transfer = openTransferById.get(line.stock_transfer_id);
    if (!transfer) continue;
    const remaining = Math.max(0, Number(line.quantity) - Number(line.received_quantity) - Number(line.short_quantity));
    if (remaining === 0) continue;
    const key = `${line.product_id}|${line.variant_id ?? ""}`;
    const quantities = inTransitBySaleable.get(key) ?? {};
    quantities[transfer.destination_store_id] = (quantities[transfer.destination_store_id] ?? 0) + remaining;
    inTransitBySaleable.set(key, quantities);
  }
  const availability = new Map(settings.map((setting) => [`${setting.product_id}|${setting.store_id}`, setting.is_available]));
  const restockIntentions = new Map(settings.map((setting) => [`${setting.product_id}|${setting.store_id}`, setting.restock_policy]));
  const valuationByStockPosition = new Map(
    (valuationResult.data ?? []).map((entry) => [
      `${entry.store_id}|${entry.product_id}|${entry.variant_id ?? ""}`,
      Number(entry.average_cost_minor),
    ]),
  );

  const saleableItems = products.flatMap<SupplyChainItem>((product) => {
    const storeIds = settings.filter((setting) => setting.product_id === product.id && setting.is_available && storeNames.has(setting.store_id)).map((setting) => setting.store_id);
    if (product.product_type === "simple") {
      return [{ productId: product.id, variantId: null, label: product.name, unit: product.unit, storeIds, quantitiesByStore: quantitiesBySaleable.get(`${product.id}|`) ?? {}, inTransitByStore: inTransitBySaleable.get(`${product.id}|`) ?? {} }];
    }
    return variants.filter((variant) => variant.product_id === product.id).map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      label: `${product.name} / ${variant.name}`,
      unit: product.unit,
      storeIds,
      quantitiesByStore: quantitiesBySaleable.get(`${product.id}|${variant.id}`) ?? {},
      inTransitByStore: inTransitBySaleable.get(`${product.id}|${variant.id}`) ?? {},
    }));
  });

  const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.id, `${warehouse.code} · ${warehouse.name}`]));
  const replenishmentRules: ReplenishmentRule[] = rules.filter((rule) => (
    restockIntentions.get(`${rule.product_id}|${rule.store_id}`) !== "do_not_restock"
  )).map((rule) => {
    const product = productById.get(rule.product_id);
    const variant = rule.variant_id ? variantById.get(rule.variant_id) : undefined;
    const item = saleableItems.find((candidate) => candidate.productId === rule.product_id && candidate.variantId === rule.variant_id);
    const sourceCandidates = warehouses
      .filter((warehouse) => warehouse.store_id !== rule.store_id)
      .map((warehouse) => ({
        id: warehouse.id,
        name: warehouseNames.get(warehouse.id) ?? warehouse.name,
        quantity: item?.quantitiesByStore[warehouse.store_id] ?? 0,
      }))
      .filter((warehouse) => warehouse.quantity > 0)
      .sort((left, right) => {
        if (left.id === rule.preferred_warehouse_id) return -1;
        if (right.id === rule.preferred_warehouse_id) return 1;
        return right.quantity - left.quantity || left.name.localeCompare(right.name);
      });
    const recommendedSource = sourceCandidates[0] ?? null;
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
      recommendedWarehouseId: recommendedSource?.id ?? null,
      recommendedWarehouseName: recommendedSource?.name ?? null,
      recommendedSourceQuantity: recommendedSource?.quantity ?? 0,
    };
  });

  const transferByRequestId = new Map(stockTransfers.flatMap((transfer) => transfer.stock_request_id ? [[transfer.stock_request_id, transfer] as const] : []));
  const transferLineByRequestLineId = new Map((stockTransferLinesResult.data ?? []).flatMap((line) => line.stock_request_line_id ? [[line.stock_request_line_id, line.id] as const] : []));
  const discrepanciesByRequestLine = new Map<string, Array<{ note: string; quantity: number; reportedAt: string }>>();
  for (const discrepancy of discrepanciesResult.data ?? []) {
    const entries = discrepanciesByRequestLine.get(discrepancy.stock_request_line_id) ?? [];
    entries.push({ note: discrepancy.note, quantity: Number(discrepancy.short_quantity), reportedAt: discrepancy.reported_at });
    discrepanciesByRequestLine.set(discrepancy.stock_request_line_id, entries);
  }
  const requestLinesByRequestId = new Map<string, typeof requestLinesResult.data>();
  for (const line of requestLinesResult.data ?? []) {
    const existing = requestLinesByRequestId.get(line.stock_request_id) ?? [];
    existing.push(line);
    requestLinesByRequestId.set(line.stock_request_id, existing);
  }
  const supplyChainRequests: SupplyChainRequest[] = requests.map((request) => ({
    id: request.id,
    requestNumber: Number(request.request_number),
    transferNumber: transferByRequestId.get(request.id)?.transfer_number ? Number(transferByRequestId.get(request.id)?.transfer_number) : null,
    status: request.status as SupplyChainRequest["status"],
    requestingStoreName: storeNames.get(request.requesting_store_id) ?? "Inactive store",
    warehouseName: warehouseNames.get(request.source_warehouse_id) ?? "Unavailable warehouse",
    note: request.note,
    requestedAt: request.requested_at,
    approvedAt: request.approved_at,
    pickedAt: request.picked_at,
    dispatchedAt: request.dispatched_at,
    receivedAt: request.received_at,
    updatedAt: request.updated_at,
    lines: (requestLinesByRequestId.get(request.id) ?? []).map((line) => ({
      id: line.id,
      transferLineId: transferByRequestId.has(request.id) ? transferLineByRequestLineId.get(line.id) ?? null : null,
      label: `${line.product_name_snapshot}${line.variant_name_snapshot ? ` / ${line.variant_name_snapshot}` : ""}`,
      unit: line.unit_snapshot,
      requestedQuantity: Number(line.requested_quantity),
      approvedQuantity: Number(line.approved_quantity),
      pickedQuantity: Number(line.picked_quantity),
      dispatchedQuantity: Number(line.dispatched_quantity),
      receivedQuantity: Number(line.received_quantity),
      shortQuantity: Number(line.short_quantity),
      discrepancies: discrepanciesByRequestLine.get(line.id) ?? [],
    })),
  }));

  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const purchaseLinesByOrder = new Map<string, typeof purchaseOrderLinesResult.data>();
  for (const line of purchaseOrderLinesResult.data ?? []) {
    const existing = purchaseLinesByOrder.get(line.purchase_order_id) ?? [];
    existing.push(line);
    purchaseLinesByOrder.set(line.purchase_order_id, existing);
  }
  const inboundPurchaseOrders: InboundPurchaseOrder[] = purchaseOrders.map((order) => ({
    id: order.id,
    orderNumber: Number(order.order_number),
    supplierName: supplierNames.get(order.supplier_id) ?? "Unavailable supplier",
    storeName: storeNames.get(order.store_id) ?? "Inactive store",
    expectedAt: order.expected_at,
    remainingQuantity: (purchaseLinesByOrder.get(order.id) ?? []).reduce((total, line) => total + Number(line.ordered_quantity) - Number(line.received_quantity), 0),
  }));

  const reorderPoints = new Map(
    rules.map((rule) => [
      `${rule.store_id}|${rule.product_id}|${rule.variant_id ?? ""}`,
      Number(rule.reorder_point),
    ]),
  );
  const stockRows = stockLevels.flatMap((level) => {
    const product = productById.get(level.product_id);
    const variant = level.variant_id ? variantById.get(level.variant_id) : undefined;
    const storeName = storeNames.get(level.store_id);
    if (!product || !storeName) return [];
    const query = new URLSearchParams({ tab: "activity", detail: level.id });
    if (storeScope.selectedStoreId) query.set("store", storeScope.selectedStoreId);
    return [{
      averageCostMinor: canViewCosts
        ? valuationByStockPosition.get(`${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`) ?? null
        : null,
      barcode: variant?.barcode ?? product.barcode,
      categoryId: product.category_id,
      categoryName: product.category_id ? categoryNames.get(product.category_id) ?? "Uncategorized" : "Uncategorized",
      detailHref: `/back-office/inventory?${query.toString()}`,
      id: level.id,
      isAvailable: availability.get(`${level.product_id}|${level.store_id}`) === true,
      productId: level.product_id,
      productName: product.name,
      quantity: Number(level.quantity),
      reorderPoint: reorderPoints.get(`${level.store_id}|${level.product_id}|${level.variant_id ?? ""}`) ?? null,
      restockPolicy: restockIntentions.get(`${level.product_id}|${level.store_id}`) === "do_not_restock" ? "do_not_restock" as const : "restock" as const,
      sku: variant?.sku ?? product.sku,
      storeId: level.store_id,
      storeName,
      unit: product.unit,
      updatedAt: level.updated_at,
      variantId: level.variant_id,
      variantName: variant?.name ?? null,
    }];
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Inventory"
        title="Stock & Restock"
        description="Review stock levels and identify replenishment needs."
        breadcrumbs={[
          { href: "/back-office", label: "Back Office" },
          { href: "/back-office/inventory", label: "Inventory" },
          { label: "Stock & Restock" },
        ]}
      />
      <InventoryWorkspaceNavigation activeTab={activeTab} canManage={canManage} storeId={storeScope.selectedStoreId} workspace="restock" />
      {activeTab === "levels" ? (
        <InventoryStockView
          archivedProductCount={archivedProductsResult.count ?? 0}
          canUseReorderStatus={canManage}
          canViewCosts={canViewCosts}
          currencyCode={context.organization.currency_code}
          initialStatus={initialStockStatus}
          multiStoreCount={stores.filter((store) => visibleStore(store.id)).length}
          preferenceScope={organizationId}
          rows={stockRows}
        />
      ) : null}
      {activeTab === "needs-restocking" && canManage ? (
        <SupplyChainWorkflows
          defaultStoreId={storeScope.selectedStoreId}
          inboundPurchaseOrders={inboundPurchaseOrders}
          items={saleableItems}
          requests={supplyChainRequests}
          rules={replenishmentRules}
          sections={["needs-restocking"]}
          stores={stores}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, leadTimeDays: supplier.lead_time_days }))}
          warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, storeId: warehouse.store_id, code: warehouse.code, name: warehouse.name }))}
        />
      ) : null}
      {activeTab === "requests" && canManage ? (
        <SupplyChainWorkflows
          defaultStoreId={storeScope.selectedStoreId}
          inboundPurchaseOrders={inboundPurchaseOrders}
          items={saleableItems}
          requests={supplyChainRequests}
          rules={replenishmentRules}
          sections={["requests"]}
          stores={stores}
          suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, leadTimeDays: supplier.lead_time_days }))}
          warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, storeId: warehouse.store_id, code: warehouse.code, name: warehouse.name }))}
        />
      ) : null}
    </div>
  );
}

function FeatureState({ title, description }: { title: string; description: string }) {
  return <div className="space-y-8"><PageHeader eyebrow="Inventory flow" title="Restock items" description={description} action={<Badge variant="outline">Unavailable</Badge>} /><Card><CardHeader className="items-center py-10 text-center"><PackageSearch className="size-8 text-muted-foreground" aria-hidden="true" /><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card></div>;
}
