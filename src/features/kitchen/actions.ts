"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  kitchenOrderPrioritySchema,
  kitchenOrderStatusSchema,
  kitchenStationSchema,
} from "@/features/kitchen/kitchen-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

const updateKitchenOrderSchema = z.object({
  kitchenOrderId: z.uuid(),
  status: kitchenOrderStatusSchema.extract(["PREPARING", "READY", "COMPLETED"]),
});

const updateKitchenOrderItemSchema = z.object({
  kitchenOrderItemId: z.uuid(),
  status: kitchenOrderStatusSchema.extract(["PREPARING", "READY", "COMPLETED"]),
});

const updateKitchenOrderPrioritySchema = z.object({
  kitchenOrderId: z.uuid(),
  priority: kitchenOrderPrioritySchema,
});

const updateKitchenStationRouteSchema = z.object({
  categoryId: z.uuid(),
  station: kitchenStationSchema,
});

export type KitchenOrderActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

function getKitchenActionErrorMessage(errorCode: string | undefined, fallback: string) {
  if (errorCode === "42501") return "You are not assigned to this kitchen order store.";
  if (errorCode === "23514") return "Kitchen work must be advanced one status at a time.";
  if (errorCode === "22023") return "Choose a valid kitchen workflow option.";
  return fallback;
}

export async function updateKitchenOrderStatusAction(
  input: unknown,
): Promise<KitchenOrderActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.kitchen_display) {
    return { ok: false, message: "Kitchen display is disabled for this business." };
  }

  if (!hasPermission(context, "kitchen.manage")) {
    return { ok: false, message: "You do not have permission to manage kitchen orders." };
  }

  const parsed = updateKitchenOrderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid kitchen order status." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_kitchen_order_status", {
    target_organization_id: context.organization.id,
    target_kitchen_order_id: parsed.data.kitchenOrderId,
    target_status: parsed.data.status,
  });

  if (error) {
    return {
      ok: false,
      message: getKitchenActionErrorMessage(error.code, "TINDIO could not update this kitchen order."),
    };
  }

  revalidatePath("/kitchen");
  return {
    ok: true,
    message: parsed.data.status === "PREPARING"
      ? "Order moved to preparing."
      : parsed.data.status === "READY"
        ? "Order marked ready."
        : "Order marked completed.",
  };
}

export async function updateKitchenOrderItemStatusAction(
  input: unknown,
): Promise<KitchenOrderActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.kitchen_display) {
    return { ok: false, message: "Kitchen display is disabled for this business." };
  }

  if (!hasPermission(context, "kitchen.manage")) {
    return { ok: false, message: "You do not have permission to manage kitchen orders." };
  }

  const parsed = updateKitchenOrderItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid kitchen item status." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_kitchen_order_item_status", {
    target_organization_id: context.organization.id,
    target_kitchen_order_item_id: parsed.data.kitchenOrderItemId,
    target_status: parsed.data.status,
  });

  if (error) {
    return { ok: false, message: getKitchenActionErrorMessage(error.code, "TINDIO could not update this kitchen item.") };
  }

  revalidatePath("/kitchen");
  return {
    ok: true,
    message: parsed.data.status === "PREPARING"
      ? "Item moved to preparing."
      : parsed.data.status === "READY"
        ? "Item marked ready."
        : "Item marked completed.",
  };
}

export async function updateKitchenOrderPriorityAction(
  input: unknown,
): Promise<KitchenOrderActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.kitchen_display || !hasPermission(context, "kitchen.manage")) {
    return { ok: false, message: "You do not have permission to set kitchen priorities." };
  }

  const parsed = updateKitchenOrderPrioritySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid kitchen priority." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_kitchen_order_priority", {
    target_organization_id: context.organization.id,
    target_kitchen_order_id: parsed.data.kitchenOrderId,
    target_priority: parsed.data.priority,
  });

  if (error) {
    return { ok: false, message: getKitchenActionErrorMessage(error.code, "TINDIO could not update this kitchen priority.") };
  }

  revalidatePath("/kitchen");
  return { ok: true, message: parsed.data.priority === "RUSH" ? "Order marked as rush." : "Order returned to normal priority." };
}

export async function updateKitchenStationRouteAction(
  input: unknown,
): Promise<KitchenOrderActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.kitchen_display || !hasPermission(context, "kitchen.manage")) {
    return { ok: false, message: "You do not have permission to manage kitchen routing." };
  }

  const parsed = updateKitchenStationRouteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "Choose a valid category and station." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_kitchen_station_category_route", {
    target_organization_id: context.organization.id,
    target_category_id: parsed.data.categoryId,
    target_station: parsed.data.station,
  });

  if (error) {
    return { ok: false, message: getKitchenActionErrorMessage(error.code, "TINDIO could not update this station route.") };
  }

  revalidatePath("/kitchen");
  return { ok: true, message: "Station route saved for future orders." };
}
