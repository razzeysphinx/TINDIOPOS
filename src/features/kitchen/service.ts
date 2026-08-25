import "server-only";

import {
  updateKitchenOrderItemSchema,
  updateKitchenOrderPrioritySchema,
  updateKitchenOrderSchema,
  updateKitchenStationRouteSchema,
} from "@/features/kitchen/kitchen-schema";
import type { KitchenOrderActionResult } from "@/features/kitchen/kitchen-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

function getKitchenActionErrorMessage(errorCode: string | undefined, fallback: string) {
  if (errorCode === "42501") return "You are not assigned to this kitchen order store.";
  if (errorCode === "23514") return "Kitchen work must be advanced one status at a time.";
  if (errorCode === "22023") return "Choose a valid kitchen workflow option.";
  return fallback;
}

export async function updateKitchenOrderStatus({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<KitchenOrderActionResult> {
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

  return {
    ok: true,
    message: parsed.data.status === "PREPARING"
      ? "Order moved to preparing."
      : parsed.data.status === "READY"
        ? "Order marked ready."
        : "Order marked completed.",
  };
}

export async function updateKitchenOrderItemStatus({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<KitchenOrderActionResult> {
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

  return {
    ok: true,
    message: parsed.data.status === "PREPARING"
      ? "Item moved to preparing."
      : parsed.data.status === "READY"
        ? "Item marked ready."
        : "Item marked completed.",
  };
}

export async function updateKitchenOrderPriority({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<KitchenOrderActionResult> {
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

  return { ok: true, message: parsed.data.priority === "RUSH" ? "Order marked as rush." : "Order returned to normal priority." };
}

export async function updateKitchenStationRoute({
  context,
  input,
}: {
  context: BusinessContext;
  input: unknown;
}): Promise<KitchenOrderActionResult> {
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

  return { ok: true, message: "Station route saved for future orders." };
}
