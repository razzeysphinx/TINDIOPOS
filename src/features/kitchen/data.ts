import "server-only";

import {
  kitchenOrderPrioritySchema,
  kitchenOrderStatusSchema,
  kitchenStationSchema,
  parseKitchenOrderItems,
  type KitchenOrder,
} from "@/features/kitchen/kitchen-types";
import { hasPermission, type BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type KitchenWorkspace = {
  orders: KitchenOrder[];
  stores: Array<{ id: string; name: string }>;
  stationRoutes: import("@/features/kitchen/kitchen-types").KitchenStationRoute[];
};

export async function loadKitchenWorkspace(
  context: BusinessContext,
): Promise<KitchenWorkspace> {
  const supabase = await createClient();
  const canManage = hasPermission(context, "kitchen.manage");
  const stationRoutesPromise = canManage
    ? supabase.rpc("get_kitchen_station_routes", {
      target_organization_id: context.organization.id,
    })
    : Promise.resolve({ data: [], error: null });
  const [ordersResult, storesResult, stationRoutesResult] = await Promise.all([
    supabase.rpc("get_kitchen_orders", {
      target_organization_id: context.organization.id,
    }),
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("id", context.storeIds)
      .order("name"),
    stationRoutesPromise,
  ]);

  if (ordersResult.error || storesResult.error || stationRoutesResult.error) {
    throw new Error(`Unable to load the kitchen display: ${ordersResult.error?.message ?? storesResult.error?.message ?? stationRoutesResult.error?.message}`);
  }

  const orders: KitchenOrder[] = (ordersResult.data ?? []).flatMap((order) => {
    const status = kitchenOrderStatusSchema.safeParse(order.status);
    const priority = kitchenOrderPrioritySchema.safeParse(order.priority);
    if (!status.success || !priority.success) return [];

    return [{
      id: order.kitchen_order_id,
      storeId: order.store_id,
      storeName: order.store_name,
      orderNumber: order.order_number,
      orderLabel: order.order_label,
      orderNote: order.order_note,
      diningOptionName: order.dining_option_name,
      priority: priority.data,
      status: status.data,
      createdAt: order.created_at,
      startedAt: order.started_at,
      readyAt: order.ready_at,
      completedAt: order.completed_at,
      items: parseKitchenOrderItems(order.items),
    }];
  });

  const stationRoutes = (stationRoutesResult.data ?? []).flatMap((route) => {
    const station = kitchenStationSchema.safeParse(route.station);
    return station.success ? [{
      categoryId: route.category_id,
      categoryName: route.category_name,
      station: station.data,
    }] : [];
  });

  return {
    orders,
    stores: storesResult.data ?? [],
    stationRoutes,
  };
}
