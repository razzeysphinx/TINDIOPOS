"use server";

import { revalidatePath } from "next/cache";

import {
  updateKitchenOrderItemStatus,
  updateKitchenOrderPriority,
  updateKitchenOrderStatus,
  updateKitchenStationRoute,
} from "@/features/kitchen/service";
import type { KitchenOrderActionResult } from "@/features/kitchen/kitchen-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

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

  const result = await updateKitchenOrderStatus({ context, input });
  if (result.ok) {
    revalidatePath("/kitchen");
  }

  return result;
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

  const result = await updateKitchenOrderItemStatus({ context, input });
  if (result.ok) {
    revalidatePath("/kitchen");
  }

  return result;
}

export async function updateKitchenOrderPriorityAction(
  input: unknown,
): Promise<KitchenOrderActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.kitchen_display || !hasPermission(context, "kitchen.manage")) {
    return { ok: false, message: "You do not have permission to set kitchen priorities." };
  }

  const result = await updateKitchenOrderPriority({ context, input });
  if (result.ok) {
    revalidatePath("/kitchen");
  }

  return result;
}

export async function updateKitchenStationRouteAction(
  input: unknown,
): Promise<KitchenOrderActionResult> {
  const context = await requireBusinessContext();

  if (!context.features.kitchen_display || !hasPermission(context, "kitchen.manage")) {
    return { ok: false, message: "You do not have permission to manage kitchen routing." };
  }

  const result = await updateKitchenStationRoute({ context, input });
  if (result.ok) {
    revalidatePath("/kitchen");
  }

  return result;
}
