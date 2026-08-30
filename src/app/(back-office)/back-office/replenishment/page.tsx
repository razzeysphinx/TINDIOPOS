import { PackageSearch } from "lucide-react";
import { notFound } from "next/navigation";

import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
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
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Replenishment" };

export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const context = await requireBackOfficePermission("inventory.manage");
  const parameters = await searchParams;
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();

  if (!context.features.inventory) {
    return <FeatureState title="Replenishment is disabled" description="An owner or administrator can enable Inventory in Business profile & features." />;
  }

  if (!hasPermission(context, "inventory.manage")) {
    return <FeatureState title="Replenishment access required" description="Your role needs Inventory management permission to manage warehouses and stock requests." />;
  }

  const supabase = await createClient();
  const organizationId = context.organization.id;
  const [
    storesResult,
    productsResult,
    variantsResult,
    settingsResult,
    levelsResult,
    warehousesResult,
    rulesResult,
    requestsResult,
    suppliersResult,
    purchaseOrdersResult,
  ] = await Promise.all([
    supabase.from("stores").select("id, name").eq("organization_id", organizationId).eq("is_active", true).order("created_at"),
    supabase.from("products").select("id, name, product_type, unit, status, track_inventory").eq("organization_id", organizationId).eq("status", "active").eq("track_inventory", true).order("name"),
    supabase.from("product_variants").select("id, product_id, name, sort_order").eq("organization_id", organizationId).eq("is_active", true).order("sort_order"),
    supabase.from("product_store_settings").select("product_id, store_id, is_available").eq("organization_id", organizationId),
    supabase.from("inventory_levels").select("store_id, product_id, variant_id, quantity").eq("organization_id", organizationId),
    supabase.from("supply_chain_warehouses").select("id, store_id, code, name").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("inventory_replenishment_rules").select("id, store_id, product_id, variant_id, preferred_warehouse_id, reorder_point, target_stock").eq("organization_id", organizationId).order("updated_at", { ascending: false }),
    supabase.from("stock_requests").select("id, request_number, requesting_store_id, source_warehouse_id, status, note, requested_at").eq("organization_id", organizationId).order("requested_at", { ascending: false }).limit(30),
    supabase.from("suppliers").select("id, name, lead_time_days").eq("organization_id", organizationId).eq("is_active", true).order("name"),
    supabase.from("purchase_orders").select("id, order_number, supplier_id, store_id, status, expected_at").eq("organization_id", organizationId).in("status", ["ordered", "partially_received"]).order("created_at", { ascending: false }).limit(20),
  ]);

  const firstError = [storesResult, productsResult, variantsResult, settingsResult, levelsResult, warehousesResult, rulesResult, requestsResult, suppliersResult, purchaseOrdersResult].find((result) => result.error)?.error;
  if (firstError) throw new Error(`Unable to load replenishment: ${firstError.message}`);

  const visibleStore = (storeId: string) => !storeScope.selectedStoreId || storeId === storeScope.selectedStoreId;
  // The filter narrows recommendations and history. Keep all RLS-authorized stock locations available so a selected destination store can still request from another authorized warehouse.
  const stores = storesResult.data ?? [];
  const products = productsResult.data ?? [];
  const variants = variantsResult.data ?? [];
  const settings = settingsResult.data ?? [];
  const levels = levelsResult.data ?? [];
  const warehouses = warehousesResult.data ?? [];
  const rules = (rulesResult.data ?? []).filter((rule) => visibleStore(rule.store_id));
  const requests = (requestsResult.data ?? []).filter((request) => visibleStore(request.requesting_store_id));
  const suppliers = suppliersResult.data ?? [];
  const purchaseOrders = (purchaseOrdersResult.data ?? []).filter((order) => visibleStore(order.store_id));
  const requestIds = requests.map((request) => request.id);
  const purchaseOrderIds = purchaseOrders.map((order) => order.id);

  const [requestLinesResult, stockTransfersResult, purchaseOrderLinesResult] = await Promise.all([
    requestIds.length
      ? supabase.from("stock_request_lines").select("id, stock_request_id, product_name_snapshot, variant_name_snapshot, unit_snapshot, requested_quantity, approved_quantity, picked_quantity, dispatched_quantity, received_quantity, short_quantity").eq("organization_id", organizationId).in("stock_request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    requestIds.length
      ? supabase.from("stock_transfers").select("id, stock_request_id").eq("organization_id", organizationId).in("stock_request_id", requestIds)
      : Promise.resolve({ data: [], error: null }),
    purchaseOrderIds.length
      ? supabase.from("purchase_order_lines").select("purchase_order_id, ordered_quantity, received_quantity").eq("organization_id", organizationId).in("purchase_order_id", purchaseOrderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const secondError = [requestLinesResult, stockTransfersResult, purchaseOrderLinesResult].find((result) => result.error)?.error;
  if (secondError) throw new Error(`Unable to load replenishment details: ${secondError.message}`);

  const stockTransfers = stockTransfersResult.data ?? [];
  const stockTransferIds = stockTransfers.map((transfer) => transfer.id);
  const stockTransferLinesResult = stockTransferIds.length
    ? await supabase.from("stock_transfer_lines").select("id, stock_transfer_id, stock_request_line_id").eq("organization_id", organizationId).in("stock_transfer_id", stockTransferIds)
    : { data: [], error: null };
  if (stockTransferLinesResult.error) throw new Error(`Unable to load transfer receiving details: ${stockTransferLinesResult.error.message}`);

  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(variants.map((variant) => [variant.id, variant]));
  const quantitiesBySaleable = new Map<string, Record<string, number>>();
  for (const level of levels) {
    const key = `${level.product_id}|${level.variant_id ?? ""}`;
    const quantities = quantitiesBySaleable.get(key) ?? {};
    quantities[level.store_id] = Number(level.quantity);
    quantitiesBySaleable.set(key, quantities);
  }

  const saleableItems = products.flatMap<SupplyChainItem>((product) => {
    const storeIds = settings.filter((setting) => setting.product_id === product.id && setting.is_available && storeNames.has(setting.store_id)).map((setting) => setting.store_id);
    if (product.product_type === "simple") {
      return [{ productId: product.id, variantId: null, label: product.name, unit: product.unit, storeIds, quantitiesByStore: quantitiesBySaleable.get(`${product.id}|`) ?? {} }];
    }
    return variants.filter((variant) => variant.product_id === product.id).map((variant) => ({
      productId: product.id,
      variantId: variant.id,
      label: `${product.name} / ${variant.name}`,
      unit: product.unit,
      storeIds,
      quantitiesByStore: quantitiesBySaleable.get(`${product.id}|${variant.id}`) ?? {},
    }));
  });

  const warehouseNames = new Map(warehouses.map((warehouse) => [warehouse.id, `${warehouse.code} · ${warehouse.name}`]));
  const replenishmentRules: ReplenishmentRule[] = rules.map((rule) => {
    const product = productById.get(rule.product_id);
    const variant = rule.variant_id ? variantById.get(rule.variant_id) : undefined;
    const item = saleableItems.find((candidate) => candidate.productId === rule.product_id && candidate.variantId === rule.variant_id);
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

  const transferByRequestId = new Map(stockTransfers.flatMap((transfer) => transfer.stock_request_id ? [[transfer.stock_request_id, transfer.id] as const] : []));
  const transferLineByRequestLineId = new Map((stockTransferLinesResult.data ?? []).flatMap((line) => line.stock_request_line_id ? [[line.stock_request_line_id, line.id] as const] : []));
  const requestLinesByRequestId = new Map<string, typeof requestLinesResult.data>();
  for (const line of requestLinesResult.data ?? []) {
    const existing = requestLinesByRequestId.get(line.stock_request_id) ?? [];
    existing.push(line);
    requestLinesByRequestId.set(line.stock_request_id, existing);
  }
  const supplyChainRequests: SupplyChainRequest[] = requests.map((request) => ({
    id: request.id,
    requestNumber: Number(request.request_number),
    status: request.status as SupplyChainRequest["status"],
    requestingStoreName: storeNames.get(request.requesting_store_id) ?? "Inactive store",
    warehouseName: warehouseNames.get(request.source_warehouse_id) ?? "Unavailable warehouse",
    note: request.note,
    requestedAt: request.requested_at,
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

  return <div className="space-y-8"><PageHeader eyebrow="Inventory flow" title="Replenishment" description="Coordinate warehouse stock requests, approval, picking, dispatch, receiving, and shortages without teleporting inventory." action={<Badge variant="secondary">Inventory management</Badge>} /><GlobalFilterBar action="/back-office/replenishment" namePrefix="replenishment-filter" showDateRange={false} storeId={storeScope.selectedStoreId} stores={await loadAuthorizedBackOfficeStores(context)} /><SupplyChainWorkflows defaultStoreId={storeScope.selectedStoreId} stores={stores} warehouses={warehouses.map((warehouse) => ({ id: warehouse.id, storeId: warehouse.store_id, code: warehouse.code, name: warehouse.name }))} suppliers={suppliers.map((supplier) => ({ id: supplier.id, name: supplier.name, leadTimeDays: supplier.lead_time_days }))} items={saleableItems} rules={replenishmentRules} requests={supplyChainRequests} inboundPurchaseOrders={inboundPurchaseOrders} /></div>;
}

function FeatureState({ title, description }: { title: string; description: string }) {
  return <div className="space-y-8"><PageHeader eyebrow="Inventory flow" title="Replenishment" description={description} action={<Badge variant="outline">Unavailable</Badge>} /><Card><CardHeader className="items-center py-10 text-center"><PackageSearch className="size-8 text-muted-foreground" aria-hidden="true" /><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader></Card></div>;
}
