import { z } from "zod";

export const kitchenOrderStatusSchema = z.enum([
  "NEW",
  "PREPARING",
  "READY",
  "COMPLETED",
]);

export const kitchenOrderPrioritySchema = z.enum(["NORMAL", "RUSH"]);
export const kitchenStationSchema = z.enum(["KITCHEN", "BAR", "DESSERT"]);
export const kitchenStationFilterSchema = z.enum([
  "ALL",
  "KITCHEN",
  "BAR",
  "DESSERT",
  "EXPEDITER",
]);

const kitchenModifierSchema = z.object({
  name: z.string().min(1).max(100),
}).passthrough();

const kitchenOrderItemsSchema = z.array(z.object({
  id: z.uuid(),
  name: z.string().min(1).max(160),
  variant_name: z.string().max(160).nullable(),
  modifiers: z.array(kitchenModifierSchema),
  quantity: z.number().int().min(1).max(10_000),
  station: kitchenStationSchema,
  status: kitchenOrderStatusSchema,
  started_at: z.string().datetime().nullable(),
  ready_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
})).max(100);

export type KitchenOrderStatus = z.infer<typeof kitchenOrderStatusSchema>;
export type KitchenOrderPriority = z.infer<typeof kitchenOrderPrioritySchema>;
export type KitchenStation = z.infer<typeof kitchenStationSchema>;
export type KitchenStationFilter = z.infer<typeof kitchenStationFilterSchema>;

export type KitchenOrderItem = {
  id: string;
  name: string;
  variantName: string | null;
  modifiers: string[];
  quantity: number;
  station: KitchenStation;
  status: KitchenOrderStatus;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
};

export type KitchenOrder = {
  id: string;
  storeId: string;
  storeName: string;
  orderNumber: number;
  orderLabel: string;
  orderNote: string | null;
  diningOptionName: string;
  priority: KitchenOrderPriority;
  status: KitchenOrderStatus;
  createdAt: string;
  startedAt: string | null;
  readyAt: string | null;
  completedAt: string | null;
  items: KitchenOrderItem[];
};

export function parseKitchenOrderItems(value: unknown): KitchenOrderItem[] {
  const parsed = kitchenOrderItemsSchema.safeParse(value);
  if (!parsed.success) return [];

  return parsed.data.map((item) => ({
    id: item.id,
    name: item.name,
    variantName: item.variant_name,
    modifiers: item.modifiers.map((modifier) => modifier.name),
    quantity: item.quantity,
    station: item.station,
    status: item.status,
    startedAt: item.started_at,
    readyAt: item.ready_at,
    completedAt: item.completed_at,
  }));
}
