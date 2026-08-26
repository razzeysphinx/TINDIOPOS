"use server";

import { revalidatePath } from "next/cache";

import {
  createDiscount,
  createDiningOption,
  createModifierGroup,
  createTaxRate,
  createTicketTemplate,
  updateDiningOption,
  updateDiscount,
  updateModifierGroup,
  updateTaxRate,
  updateTicketTemplate,
} from "@/features/advanced-sales/service";
import type { AdvancedSalesResult } from "@/features/advanced-sales/advanced-sales-types";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

function refresh() {
  revalidatePath("/back-office/advanced-sales");
  revalidatePath("/pos");
}

export async function createDiscountAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to configure advanced sales." };
  const result = await createDiscount(context, input);
  if (result.ok) refresh();
  return result;
}

export async function createTaxRateAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to configure advanced sales." };
  const result = await createTaxRate(context, input);
  if (result.ok) refresh();
  return result;
}

export async function createDiningOptionAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage") || !context.features.dining) return { ok: false, message: "Dining is disabled or you do not have permission to configure it." };
  const result = await createDiningOption(context, input);
  if (result.ok) refresh();
  return result;
}

export async function createTicketTemplateAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage") || !context.features.open_tickets) return { ok: false, message: "Open tickets are disabled or you do not have permission to configure them." };
  const result = await createTicketTemplate(context, input);
  if (result.ok) refresh();
  return result;
}

export async function createModifierGroupAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage") || !context.features.modifiers) return { ok: false, message: "Modifiers are disabled or you do not have permission to configure them." };
  const result = await createModifierGroup(context, input);
  if (result.ok) refresh();
  return result;
}

export async function updateDiscountAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to configure advanced sales." };
  const result = await updateDiscount(context, input);
  if (result.ok) refresh();
  return result;
}

export async function updateTaxRateAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage")) return { ok: false, message: "You do not have permission to configure advanced sales." };
  const result = await updateTaxRate(context, input);
  if (result.ok) refresh();
  return result;
}

export async function updateDiningOptionAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage") || !context.features.dining) return { ok: false, message: "Dining is disabled or you do not have permission to configure it." };
  const result = await updateDiningOption(context, input);
  if (result.ok) refresh();
  return result;
}

export async function updateTicketTemplateAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage") || !context.features.open_tickets) return { ok: false, message: "Open tickets are disabled or you do not have permission to configure them." };
  const result = await updateTicketTemplate(context, input);
  if (result.ok) refresh();
  return result;
}

export async function updateModifierGroupAction(input: unknown): Promise<AdvancedSalesResult> {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "products.manage") || !context.features.modifiers) return { ok: false, message: "Modifiers are disabled or you do not have permission to configure them." };
  const result = await updateModifierGroup(context, input);
  if (result.ok) refresh();
  return result;
}
