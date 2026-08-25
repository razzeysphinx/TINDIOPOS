import { z } from "zod";

import {
  kitchenOrderPrioritySchema,
  kitchenOrderStatusSchema,
  kitchenStationSchema,
} from "@/features/kitchen/kitchen-types";

export const updateKitchenOrderSchema = z.object({
  kitchenOrderId: z.uuid(),
  status: kitchenOrderStatusSchema.extract(["PREPARING", "READY", "COMPLETED"]),
});

export const updateKitchenOrderItemSchema = z.object({
  kitchenOrderItemId: z.uuid(),
  status: kitchenOrderStatusSchema.extract(["PREPARING", "READY", "COMPLETED"]),
});

export const updateKitchenOrderPrioritySchema = z.object({
  kitchenOrderId: z.uuid(),
  priority: kitchenOrderPrioritySchema,
});

export const updateKitchenStationRouteSchema = z.object({
  categoryId: z.uuid(),
  station: kitchenStationSchema,
});
