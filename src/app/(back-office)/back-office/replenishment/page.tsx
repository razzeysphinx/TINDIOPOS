import { PackageSearch } from "lucide-react";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SupplyChainWorkflows,
  type InboundPurchaseOrder,
  type ReplenishmentRule,
  type ReplenishmentSourceOption,
  type SupplyChainItem,
  type SupplyChainRequest,
} from "@/features/inventory/supply-chain-workflows";
import {
  InventoryStockView,
  type InventoryRestockPolicyFilter,
  type InventoryStockFilters,
  type InventoryStockRow,
  type InventoryStockSort,
  type InventoryStockStatus,
} from "@/features/inventory/inventory-stock-view";
import {
  InventoryWorkspaceNavigation,
  type StockRestockTab,
} from "@/features/inventory/inventory-workspace-navigation";
import { hasAnyInventoryCapability, hasInventoryCapability } from "@/features/inventory/inventory-permissions";
import { RECEIVABLE_TRANSFER_QUERY_STATUSES } from "@/features/inventory/inventory-transfer-reader-contract";
import { resolveBackOfficeStoreScope } from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Stock & Restock" };

const STOCK_RESTOCK_TABS: readonly StockRestockTab[] = ["levels", "replenishment"];

function resolveStockRestockTab(value: string | string[] | undefined): StockRestockTab {
  const candidate = Array.isArray(value) ? value[0] : value;
  // CANDIDATE_FOR_REMOVAL: keep historical links working while the two
  // previous views are combined in the Replenishment workspace.
  if (candidate === "needs-restocking" || candidate === "requests") return "replenishment";
  return STOCK_RESTOCK_TABS.includes(candidate as StockRestockTab) ? candidate as StockRestockTab : "levels";
}

function resolveStockStatus(value: string | string[] | undefined): InventoryStockStatus {
  const candidate = Array.isArray(value) ? value[0] : value;
  const allowed: readonly InventoryStockStatus[] = ["all", "attention", "available", "in_stock", "low", "negative", "out_of_stock"];
  return allowed.includes(candidate as InventoryStockStatus) ? candidate as InventoryStockStatus : "all";
}

function resolveStockSort(value: string | string[] | undefined): InventoryStockSort {
  const candidate = Array.isArray(value) ? value[0] : value;
  const allowed: readonly InventoryStockSort[] = ["priority", "name_asc", "name_desc", "quantity_asc", "quantity_desc", "updated_desc", "value_desc"];
  return allowed.includes(candidate as InventoryStockSort) ? candidate as InventoryStockSort : "priority";
}

function resolveRestockPolicy(value: string | string[] | undefined): InventoryRestockPolicyFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === "restock" || candidate === "do_not_restock" ? candidate : "all";
}

function resolveStockPage(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

function resolveOptionalUuid(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function resolveStockSearch(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate ? candidate.trim().slice(0, 160) : "";
}

function stockDetailHref({
  levelId,
  productId,
  storeId,
  variantId,
}: {
  levelId: string | null;
  productId: string;
  storeId: string;
  variantId: string | null;
}) {
  const query = new URLSearchParams({ store: storeId, tab: "activity" });
  if (levelId) query.set("detail", levelId);
  else {
    query.set("detailProduct", productId);
    if (variantId) query.set("detailVariant", variantId);
  }
  return `/back-office/inventory?${query.toString()}`;
}

export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<{
    category?: string | string[];
    detail?: string;
    restockPolicy?: string | string[];
    status?: string | string[];
    stockPage?: string | string[];
    stockSearch?: string | string[];
    stockSort?: string | string[];
    store?: string;
    tab?: string | string[];
  }>;
}) {
  const context = await requireBackOfficePermission([
    "inventory.view",
    "inventory.manage",
    "inventory.transfer.create",
    "inventory.transfer.send",
    "inventory.transfer.receive",
  ]);
  const parameters = await searchParams;
  const activeTab = resolveStockRestockTab(parameters.tab);
  const initialStockStatus = resolveStockStatus(parameters.status);
  const stockFilters: InventoryStockFilters = {
    categoryId: resolveOptionalUuid(parameters.category),
    restockPolicy: resolveRestockPolicy(parameters.restockPolicy),
    search: resolveStockSearch(parameters.stockSearch),
    selectedStoreId: null,
    sort: resolveStockSort(parameters.stockSort),
    status: initialStockStatus,
  };
  const stockPage = resolveStockPage(parameters.stockPage);
  const canManage = hasPermission(context, "inventory.manage");
  const canCreateTransfers = hasInventoryCapability(context, "inventory.transfer.create");
  const canSendTransfers = hasInventoryCapability(context, "inventory.transfer.send");
  const canReceiveTransfers = hasInventoryCapability(context, "inventory.transfer.receive");
  const canAccessTransfers = hasAnyInventoryCapability(context, [
    "inventory.transfer.create",
    "inventory.transfer.send",
    "inventory.transfer.receive",
  ]);
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();
  stockFilters.selectedStoreId = storeScope.selectedStoreId;
  if (!canManage && (stockFilters.status === "attention" || stockFilters.status === "low")) {
    stockFilters.status = "all";
  }

  if (!context.features.inventory) {
    return <FeatureState title="Restock items is unavailable" description="An owner or administrator can enable Inventory in Business profile & features." />;
  }

  if (!canManage && !canAccessTransfers && activeTab !== "levels") {
    return <FeatureState title="Restock items access required" description="Your role needs transfer or inventory-management access to work with stock requests." />;
  }

  const supabase = await createClient();
  const organizationId = context.organization.id;
  const canViewCosts = hasPermission(context, "products.view_cost");
  const loadSupplyChain = activeTab === "replenishment";
  const stockPageSize = 50;
  const [
    storesResult,
    categoriesResult,
    stockPageResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    warehousesResult,
    rulesResult,
    requestsResult,
    suppliersResult,
    purchaseOrdersResult,
    archivedProductsResult,
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("organization_id", organizationId).eq("is_active", true).order("created_at"),
    supabase.from("categories").select("id, name").eq("organization_id", organizationId).eq("is_archived", false).order("name"),
    activeTab === "levels"
      ? supabase.rpc("get_inventory_stock_page", {
          requested_category_id: stockFilters.categoryId ?? undefined,
          requested_page: stockPage,
          requested_page_size: stockPageSize,
          requested_restock_policy: stockFilters.restockPolicy,
          requested_search: stockFilters.search || undefined,
          requested_sort: stockFilters.sort,
          requested_status: stockFilters.status,
          requested_store_id: storeScope.selectedStoreId ?? undefined,
          target_organization_id: organizationId,
        })
      : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("products").select("id, category_id, name, sku, barcode, product_type, unit, status, track_inventory").eq("organization_id", organizationId).eq("status", "active").eq("track_inventory", true).order("name") : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("product_variants").select("id, product_id, name, sku, barcode, sort_order").eq("organization_id", organizationId).eq("is_active", true).order("sort_order") : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("product_store_settings").select("product_id, store_id, is_available, restock_policy, updated_at").eq("organization_id", organizationId) : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("inventory_levels").select("id, store_id, product_id, variant_id, quantity, updated_at").eq("organization_id", organizationId) : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("supply_chain_warehouses").select("id, store_id, code, name").eq("organization_id", organizationId).eq("is_active", true).order("name") : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("inventory_replenishment_rules").select("id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock").eq("organization_id", organizationId).order("updated_at", { ascending: false }) : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("stock_requests").select("id, request_number, requesting_store_id, source_warehouse_id, status, note, requested_at, approved_at, picked_at, dispatched_at, received_at, updated_at").eq("organization_id", organizationId).order("requested_at", { ascending: false }).limit(30) : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("suppliers").select("id, name, lead_time_days").eq("organization_id", organizationId).eq("is_active", true).order("name") : Promise.resolve({ data: null, error: null }),
    loadSupplyChain ? supabase.from("purchase_orders").select("id, order_number, supplier_id, store_id, status, expected_at").eq("organization_id", organizationId).in("status", ["ordered", "partially_received"]).order("created_at", { ascending: false }).limit(20) : Promise.resolve({ data: null, error: null }),
    activeTab === "levels" ? supabase.from("products").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "archived") : Promise.resolve({ count: 0, data: null, error: null }),
  ]);

  const firstError = [storesResult, categoriesResult, stockPageResult, productsResult, variantsResult, settingsResult, levelsResult, warehousesResult, rulesResult, requestsResult, suppliersResult, purchaseOrdersResult, archivedProductsResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(`Unable to load replenishment: ${firstError.message}`);

  const authorizedStore = (storeId: string) => storeScope.storeIds === null || storeScope.storeIds.includes(storeId);
  const visibleStore = (storeId: string) => authorizedStore(storeId) && (
    !storeScope.selectedStoreId || storeId === storeScope.selectedStoreId
  );
  // Recommendation destinations honour the active filter. Source assessments
  // may inspect every store the employee is already authorised to manage so a
  // selected destination cannot hide a safe internal source.
  const authorizedStores = (storesResult.data ?? []).filter((store) => authorizedStore(store.id));
  const stores = authorizedStores.filter((store) => visibleStore(store.id));
  const categories = categoriesResult.data ?? [];
  const stockPageEntries = stockPageResult.data ?? [];
  const stockRows: InventoryStockRow[] = stockPageEntries.map((entry) => ({
    averageCostMinor: entry.average_cost_minor === null ? null : Number(entry.average_cost_minor),
    barcode: entry.barcode,
    categoryId: entry.category_id,
    categoryName: entry.category_name ?? "Uncategorized",
    detailHref: stockDetailHref({
      levelId: entry.level_id,
      productId: entry.product_id,
      storeId: entry.store_id,
      variantId: entry.variant_id,
    }),
    id: entry.level_id ?? `uninitialized:${entry.store_id}|${entry.product_id}|${entry.variant_id ?? ""}`,
    isAvailable: entry.is_available,
    productId: entry.product_id,
    productName: entry.product_name,
    quantity: Number(entry.quantity),
    reorderPoint: entry.reorder_point === null ? null : Number(entry.reorder_point),
    restockPolicy: entry.restock_policy === "do_not_restock" ? "do_not_restock" : "restock",
    sku: entry.sku,
    storeId: entry.store_id,
    storeName: entry.store_name,
    unit: entry.unit,
    updatedAt: entry.updated_at,
    variantId: entry.variant_id,
    variantName: entry.variant_name,
  }));
  const stockPageSummary = stockPageEntries[0]
    ? {
        activeProductCount: Number(stockPageEntries[0].active_product_count),
        inStockCount: Number(stockPageEntries[0].in_stock_count),
        lowCount: Number(stockPageEntries[0].low_count),
        negativeCount: Number(stockPageEntries[0].negative_count),
        outOfStockCount: Number(stockPageEntries[0].out_of_stock_count),
      }
    : { activeProductCount: 0, inStockCount: 0, lowCount: 0, negativeCount: 0, outOfStockCount: 0 };
  const stockTotalCount = stockPageEntries[0] ? Number(stockPageEntries[0].total_count) : 0;
  const products = productsResult.data ?? [];
  const variants = variantsResult.data ?? [];
  const settings = (settingsResult.data ?? []).filter((setting) => authorizedStore(setting.store_id));
  const levels = (levelsResult.data ?? []).filter((level) => authorizedStore(level.store_id));
  const warehouses = (warehousesResult.data ?? []).filter((warehouse) => authorizedStore(warehouse.store_id));
  const authorizedRules = (rulesResult.data ?? []).filter((rule) => authorizedStore(rule.store_id));
  const rules = authorizedRules.filter((rule) => visibleStore(rule.store_id));
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
    loadSupplyChain
      ? supabase.from("stock_transfers").select("id, stock_request_id, destination_store_id, status, transfer_number").eq("organization_id", organizationId).in("status", [...RECEIVABLE_TRANSFER_QUERY_STATUSES])
      : Promise.resolve({ data: [], error: null }),
    purchaseOrderIds.length
      ? supabase.from("purchase_order_lines").select("purchase_order_id, product_id, variant_id, ordered_quantity, received_quantity").eq("organization_id", organizationId).in("purchase_order_id", purchaseOrderIds)
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

  const storeNames = new Map(authorizedStores.map((store) => [store.id, store.name]));
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
  const incomingPurchaseBySaleable = new Map<string, Record<string, number>>();
  const purchaseOrderById = new Map(purchaseOrders.map((order) => [order.id, order]));
  for (const line of purchaseOrderLinesResult.data ?? []) {
    const purchaseOrder = purchaseOrderById.get(line.purchase_order_id);
    if (!purchaseOrder) continue;
    const remaining = Math.max(0, Number(line.ordered_quantity) - Number(line.received_quantity));
    if (remaining === 0) continue;
    const key = `${line.product_id}|${line.variant_id ?? ""}`;
    const quantities = incomingPurchaseBySaleable.get(key) ?? {};
    quantities[purchaseOrder.store_id] = (quantities[purchaseOrder.store_id] ?? 0) + remaining;
    incomingPurchaseBySaleable.set(key, quantities);
  }
  const restockIntentions = new Map(settings.map((setting) => [`${setting.product_id}|${setting.store_id}`, setting.restock_policy]));

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
  const targetStockByPosition = new Map(
    authorizedRules.map((rule) => [
      `${rule.store_id}|${rule.product_id}|${rule.variant_id ?? ""}`,
      Number(rule.target_stock),
    ]),
  );
  const warehousesByStore = new Map<string, typeof warehouses>();
  for (const warehouse of warehouses) {
    const entries = warehousesByStore.get(warehouse.store_id) ?? [];
    entries.push(warehouse);
    warehousesByStore.set(warehouse.store_id, entries);
  }
  const replenishmentRules: ReplenishmentRule[] = rules.map((rule) => {
    const product = productById.get(rule.product_id);
    const variant = rule.variant_id ? variantById.get(rule.variant_id) : undefined;
    const item = saleableItems.find((candidate) => candidate.productId === rule.product_id && candidate.variantId === rule.variant_id);
    const sourceOptions: ReplenishmentSourceOption[] = authorizedStores
      .filter((store) => store.id !== rule.store_id)
      .map((store) => {
        const onHandQuantity = item?.quantitiesByStore[store.id] ?? 0;
        const sourceTargetStock = targetStockByPosition.get(`${store.id}|${rule.product_id}|${rule.variant_id ?? ""}`) ?? null;
        const sourceWarehouses = warehousesByStore.get(store.id) ?? [];
        const warehouse = sourceWarehouses.find((candidate) => candidate.id === rule.preferred_warehouse_id)
          ?? sourceWarehouses[0]
          ?? null;
        return {
          warehouseId: warehouse?.id ?? null,
          warehouseName: warehouse ? warehouseNames.get(warehouse.id) ?? warehouse.name : null,
          storeId: store.id,
          storeName: store.name,
          onHandQuantity,
          targetStock: sourceTargetStock,
          safeExcessQuantity: sourceTargetStock === null ? null : Math.max(0, onHandQuantity - sourceTargetStock),
        };
      });
    sourceOptions.sort((left, right) => {
      if (left.warehouseId === rule.preferred_warehouse_id) return -1;
      if (right.warehouseId === rule.preferred_warehouse_id) return 1;
      return (right.safeExcessQuantity ?? -1) - (left.safeExcessQuantity ?? -1)
        || right.onHandQuantity - left.onHandQuantity
        || left.storeName.localeCompare(right.storeName);
    });
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
      incomingPurchaseQuantity: incomingPurchaseBySaleable.get(`${rule.product_id}|${rule.variant_id ?? ""}`)?.[rule.store_id] ?? 0,
      inTransitQuantity: inTransitBySaleable.get(`${rule.product_id}|${rule.variant_id ?? ""}`)?.[rule.store_id] ?? 0,
      restockPolicy: restockIntentions.get(`${rule.product_id}|${rule.store_id}`) === "do_not_restock" ? "do_not_restock" as const : "restock" as const,
      storeName: storeNames.get(rule.store_id) ?? "Inactive store",
      warehouseName: rule.preferred_warehouse_id ? warehouseNames.get(rule.preferred_warehouse_id) ?? "Unavailable warehouse" : null,
      sourceOptions,
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
      <InventoryWorkspaceNavigation activeTab={activeTab} canManage={canManage} canTransfer={canAccessTransfers} storeId={storeScope.selectedStoreId} workspace="restock" />
      {activeTab === "levels" ? (
        <InventoryStockView
          archivedProductCount={archivedProductsResult.count ?? 0}
          canUseReorderStatus={canManage}
          canViewCosts={canViewCosts}
          categories={categories.map((category) => ({ id: category.id, name: category.name }))}
          currencyCode={context.organization.currency_code}
          filters={stockFilters}
          key={JSON.stringify(stockFilters)}
          multiStoreCount={stores.length}
          page={stockPage}
          pageSize={stockPageSize}
          preferenceScope={organizationId}
          rows={stockRows}
          stores={stores.map((store) => ({ id: store.id, name: store.name }))}
          summary={stockPageSummary}
          totalCount={stockTotalCount}
        />
      ) : null}
      {activeTab === "replenishment" && (canManage || canAccessTransfers) ? (
        <SupplyChainWorkflows
          canCreateTransfers={canCreateTransfers}
          canReceiveTransfers={canReceiveTransfers}
          canSendTransfers={canSendTransfers}
          defaultStoreId={storeScope.selectedStoreId}
          inboundPurchaseOrders={inboundPurchaseOrders}
          items={saleableItems}
          requests={supplyChainRequests}
          rules={replenishmentRules}
          sections={["needs-restocking", "requests"]}
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
