"use client";

import { Check, ChefHat, CircleAlert, Clock3, Flag, LoaderCircle, Play, Soup } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  updateKitchenOrderItemStatusAction,
  updateKitchenOrderPriorityAction,
  updateKitchenOrderStatusAction,
  updateKitchenStationRouteAction,
} from "@/features/kitchen/actions";
import type {
  KitchenOrder,
  KitchenOrderItem,
  KitchenOrderStatus,
  KitchenStation,
  KitchenStationFilter,
} from "@/features/kitchen/kitchen-types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const activeStatuses: KitchenOrderStatus[] = ["NEW", "PREPARING", "READY"];
const stationFilters: Array<{ id: KitchenStationFilter; label: string; description: string }> = [
  { id: "ALL", label: "All stations", description: "Every active order" },
  { id: "KITCHEN", label: "Kitchen", description: "Main food preparation" },
  { id: "BAR", label: "Bar", description: "Drinks and beverages" },
  { id: "DESSERT", label: "Dessert", description: "Sweet course preparation" },
  { id: "EXPEDITER", label: "Expediter", description: "Orders ready to serve" },
];

const statusMetadata: Record<KitchenOrderStatus, { label: string; description: string }> = {
  NEW: { label: "New", description: "Waiting to be started" },
  PREPARING: { label: "Preparing", description: "In progress" },
  READY: { label: "Ready", description: "Ready to serve" },
  COMPLETED: { label: "Completed", description: "Recently completed" },
};

const stationLabels: Record<KitchenStation, string> = {
  KITCHEN: "Kitchen",
  BAR: "Bar",
  DESSERT: "Dessert",
};

function elapsedMinutes(value: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(value).getTime()) / 60_000));
}

function elapsedTime(value: string, now: number) {
  const minutes = elapsedMinutes(value, now);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function ageClassName(value: string, now: number) {
  const minutes = elapsedMinutes(value, now);
  if (minutes >= 20) return "text-destructive";
  if (minutes >= 10) return "text-amber-700 dark:text-amber-400";
  return "text-muted-foreground";
}

function nextStatus(status: KitchenOrderStatus) {
  if (status === "NEW") return "PREPARING" as const;
  if (status === "PREPARING") return "READY" as const;
  if (status === "READY") return "COMPLETED" as const;
  return null;
}

function nextActionLabel(status: KitchenOrderStatus) {
  if (status === "NEW") return "Start preparing";
  if (status === "PREPARING") return "Mark ready";
  if (status === "READY") return "Complete order";
  return null;
}

function shouldShowOrder(order: KitchenOrder, station: KitchenStationFilter) {
  if (station === "ALL") return true;
  if (station === "EXPEDITER") return order.status === "READY";
  return order.items.some((item) => item.station === station && item.status !== "COMPLETED");
}

function visibleItems(order: KitchenOrder, station: KitchenStationFilter) {
  if (station === "KITCHEN" || station === "BAR" || station === "DESSERT") {
    return order.items.filter((item) => item.station === station);
  }
  return order.items;
}

function KitchenItemRow({
  canManage,
  item,
  onAdvance,
  pendingKey,
}: {
  canManage: boolean;
  item: KitchenOrderItem;
  onAdvance: (item: KitchenOrderItem) => void;
  pendingKey: string | null;
}) {
  const targetStatus = nextStatus(item.status);
  const isPending = pendingKey === item.id;

  return (
    <li className="rounded-lg border bg-background/60 p-3">
      <div className="flex gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-xs font-bold text-secondary-foreground">
          {item.quantity}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{item.name}</p>
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase text-muted-foreground">
              {stationLabels[item.station]}
            </span>
            <span className="text-xs font-medium text-muted-foreground">{statusMetadata[item.status].label}</span>
          </div>
          {item.variantName ? <p className="mt-0.5 text-sm text-muted-foreground">{item.variantName}</p> : null}
          {item.modifiers.length > 0 ? (
            <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-950 dark:text-amber-200">
              {item.modifiers.join(" · ")}
            </p>
          ) : null}
        </div>
      </div>
      {canManage && targetStatus ? (
        <Button
          className="mt-3 h-8 w-full text-xs"
          disabled={pendingKey !== null}
          onClick={() => onAdvance(item)}
          size="sm"
          type="button"
          variant="outline"
        >
          {isPending ? <LoaderCircle className="animate-spin" /> : item.status === "NEW" ? <Play /> : <Check />}
          {nextActionLabel(item.status)} item
        </Button>
      ) : null}
    </li>
  );
}

function KitchenOrderCard({
  canManage,
  now,
  onAdvanceItem,
  onAdvanceOrder,
  onPriorityChange,
  order,
  pendingKey,
  stationFilter,
}: {
  canManage: boolean;
  now: number;
  onAdvanceItem: (item: KitchenOrderItem) => void;
  onAdvanceOrder: (order: KitchenOrder) => void;
  onPriorityChange: (order: KitchenOrder) => void;
  order: KitchenOrder;
  pendingKey: string | null;
  stationFilter: KitchenStationFilter;
}) {
  const targetStatus = nextStatus(order.status);
  const actionLabel = nextActionLabel(order.status);
  const displayedItems = visibleItems(order, stationFilter);
  const isOrderPending = pendingKey === order.id;
  const isRush = order.priority === "RUSH";

  return (
    <Card className={cn("overflow-hidden", isRush && "border-amber-500/70 ring-1 ring-amber-500/20")}>
      <CardHeader className="border-b bg-card px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xl font-semibold tracking-[-0.03em]">#{order.orderNumber}</p>
              {isRush ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-1 text-[11px] font-bold text-amber-900 dark:text-amber-200"><Flag className="size-3" />Rush</span> : null}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">{order.orderLabel}</p>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
            {order.diningOptionName}
          </span>
        </div>
        <p className={cn("flex items-center gap-1.5 text-xs font-medium", ageClassName(order.createdAt, now))}>
          <Clock3 aria-hidden="true" className="size-3.5" />
          {elapsedTime(order.createdAt, now)} · {order.storeName}
          {elapsedMinutes(order.createdAt, now) >= 10 ? <CircleAlert aria-hidden="true" className="size-3.5" /> : null}
        </p>
      </CardHeader>
      <CardContent className="px-4 py-4 sm:px-5">
        <ul className="space-y-3" aria-label={`Items for order ${order.orderNumber}`}>
          {displayedItems.map((item) => (
            <KitchenItemRow canManage={canManage} item={item} key={item.id} onAdvance={onAdvanceItem} pendingKey={pendingKey} />
          ))}
        </ul>
        {order.orderNote ? <p className="mt-4 rounded-lg border border-dashed bg-muted/30 px-3 py-2 text-sm">Note: {order.orderNote}</p> : null}
        {canManage ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <Button
              disabled={pendingKey !== null}
              onClick={() => onPriorityChange(order)}
              size="sm"
              type="button"
              variant={isRush ? "secondary" : "outline"}
            >
              <Flag />
              {isRush ? "Normal priority" : "Mark rush"}
            </Button>
            {targetStatus && actionLabel ? (
              <Button disabled={pendingKey !== null} onClick={() => onAdvanceOrder(order)} size="sm" type="button" variant={order.status === "READY" ? "default" : "outline"}>
                {isOrderPending ? <LoaderCircle className="animate-spin" /> : order.status === "NEW" ? <Play /> : <Check />}
                {actionLabel}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StationRoutingSettings({
  onRouteChange,
  pendingKey,
  routes,
}: {
  onRouteChange: (categoryId: string, station: KitchenStation) => void;
  pendingKey: string | null;
  routes: Array<{ categoryId: string; categoryName: string; station: KitchenStation }>;
}) {
  if (routes.length === 0) return null;

  return (
    <section className="mt-7 rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby="kitchen-station-routing">
      <div className="flex items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-secondary text-primary"><Soup aria-hidden="true" className="size-5" /></span>
        <div>
          <h2 className="font-semibold" id="kitchen-station-routing">Station routing</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose where future completed dining-sale items appear. Existing tickets keep their original route.</p>
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {routes.map((route) => (
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm" key={route.categoryId}>
            <span className="min-w-0 truncate font-medium">{route.categoryName}</span>
            <select
              aria-label={`${route.categoryName} kitchen station`}
              className="h-8 rounded-md border bg-background px-2 text-xs font-medium"
              value={route.station}
              disabled={pendingKey !== null}
              onChange={(event) => onRouteChange(route.categoryId, event.currentTarget.value as KitchenStation)}
            >
              <option value="KITCHEN">Kitchen</option>
              <option value="BAR">Bar</option>
              <option value="DESSERT">Dessert</option>
            </select>
          </label>
        ))}
      </div>
    </section>
  );
}

export function KitchenDisplay({
  canManage,
  organizationId,
  orders,
  stationRoutes,
  stores,
}: {
  canManage: boolean;
  organizationId: string;
  orders: KitchenOrder[];
  stationRoutes: Array<{ categoryId: string; categoryName: string; station: KitchenStation }>;
  stores: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [stationFilter, setStationFilter] = useState<KitchenStationFilter>("ALL");
  const [, startTransition] = useTransition();

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    const channels: RealtimeChannel[] = [];
    let cancelled = false;
    let refreshTimeout: number | null = null;
    const refreshOrders = () => {
      if (refreshTimeout !== null) return;
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = null;
        router.refresh();
      }, 150);
    };

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      supabase.realtime.setAuth(data.session.access_token);

      for (const store of stores) {
        const channel = supabase
          .channel(`tindio:kitchen:${organizationId}:${store.id}`, { config: { private: true } })
          .on("broadcast", { event: "kitchen-order-changed" }, refreshOrders)
          .subscribe();
        channels.push(channel);
      }
    });

    return () => {
      cancelled = true;
      if (refreshTimeout !== null) window.clearTimeout(refreshTimeout);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [organizationId, router, stores]);

  const runAction = (key: string, action: () => Promise<{ ok: boolean; message: string }>) => {
    setMessage(null);
    setPendingKey(key);
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      setPendingKey(null);
      if (result.ok) router.refresh();
    });
  };

  const advanceOrder = (order: KitchenOrder) => {
    const status = nextStatus(order.status);
    if (!status) return;
    runAction(order.id, () => updateKitchenOrderStatusAction({ kitchenOrderId: order.id, status }));
  };

  const advanceItem = (item: KitchenOrderItem) => {
    const status = nextStatus(item.status);
    if (!status) return;
    runAction(item.id, () => updateKitchenOrderItemStatusAction({ kitchenOrderItemId: item.id, status }));
  };

  const togglePriority = (order: KitchenOrder) => {
    runAction(order.id, () => updateKitchenOrderPriorityAction({
      kitchenOrderId: order.id,
      priority: order.priority === "RUSH" ? "NORMAL" : "RUSH",
    }));
  };

  const updateRoute = (categoryId: string, station: KitchenStation) => {
    runAction(categoryId, () => updateKitchenStationRouteAction({ categoryId, station }));
  };

  const filteredOrders = useMemo(
    () => orders.filter((order) => shouldShowOrder(order, stationFilter)),
    [orders, stationFilter],
  );
  const activeOrderCount = orders.filter((order) => order.status !== "COMPLETED").length;
  const completedOrders = filteredOrders.filter((order) => order.status === "COMPLETED");
  const activeStation = stationFilters.find((station) => station.id === stationFilter) ?? stationFilters[0];

  return (
    <main className="min-h-svh bg-muted/35 p-3 sm:p-5 lg:p-7">
      <section className="mx-auto max-w-[110rem]">
        <header className="mb-5 flex flex-col gap-4 rounded-2xl border bg-card px-5 py-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><ChefHat aria-hidden="true" className="size-5" /></span>
            <div>
              <h1 className="text-lg font-semibold tracking-[-0.025em]">Kitchen display</h1>
              <p className="text-sm text-muted-foreground">{activeOrderCount} active {activeOrderCount === 1 ? "order" : "orders"} across {stores.length === 1 ? stores[0]?.name : `${stores.length} stores`}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Soup aria-hidden="true" className="size-4 text-primary" />{canManage ? "Kitchen controls enabled" : "View-only access"}</div>
        </header>

        <section className="mb-5 rounded-2xl border bg-card p-3" aria-label="Kitchen station filters">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {stationFilters.map((station) => (
              <button
                className={cn("rounded-xl border px-4 py-3 text-left transition-colors hover:bg-muted/60", stationFilter === station.id && "border-primary bg-primary/5")}
                key={station.id}
                onClick={() => setStationFilter(station.id)}
                type="button"
              >
                <span className="block font-semibold">{station.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{station.description}</span>
              </button>
            ))}
          </div>
        </section>

        {message ? <p aria-live="polite" className="mb-4 rounded-lg border bg-card px-4 py-3 text-sm">{message}</p> : null}

        <div className="grid gap-5 xl:grid-cols-3">
          {activeStatuses.map((status) => {
            const statusOrders = filteredOrders.filter((order) => order.status === status);
            const metadata = statusMetadata[status];
            return (
              <section className="min-w-0" key={status} aria-labelledby={`kitchen-${stationFilter.toLowerCase()}-${status.toLowerCase()}`}>
                <div className="mb-3 flex items-end justify-between gap-3 px-1">
                  <div>
                    <h2 className="font-semibold" id={`kitchen-${stationFilter.toLowerCase()}-${status.toLowerCase()}`}>{metadata.label}</h2>
                    <p className="text-xs text-muted-foreground">{metadata.description} · {activeStation.label}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">{statusOrders.length}</span>
                </div>
                <div className="grid gap-4">
                  {statusOrders.map((order) => <KitchenOrderCard canManage={canManage} key={order.id} now={now} onAdvanceItem={advanceItem} onAdvanceOrder={advanceOrder} onPriorityChange={togglePriority} order={order} pendingKey={pendingKey} stationFilter={stationFilter} />)}
                  {statusOrders.length === 0 ? <div className="grid min-h-36 place-items-center rounded-xl border border-dashed bg-muted/20 px-4 text-center text-sm text-muted-foreground">No {metadata.label.toLowerCase()} orders</div> : null}
                </div>
              </section>
            );
          })}
        </div>

        {completedOrders.length > 0 ? (
          <section className="mt-7" aria-labelledby="recently-completed-kitchen-orders">
            <h2 className="mb-3 px-1 font-semibold" id="recently-completed-kitchen-orders">Recently completed</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {completedOrders.map((order) => (
                <div className="flex items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 text-sm" key={order.id}>
                  <div><span className="font-semibold">#{order.orderNumber}</span><span className="ml-2 text-muted-foreground">{order.orderLabel}</span></div>
                  <span className="text-xs text-muted-foreground">{order.completedAt ? elapsedTime(order.completedAt, now) : "Completed"}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {canManage ? <StationRoutingSettings onRouteChange={updateRoute} pendingKey={pendingKey} routes={stationRoutes} /> : null}
      </section>
    </main>
  );
}
