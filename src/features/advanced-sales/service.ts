/* eslint-disable @typescript-eslint/no-explicit-any */
import "server-only";

import { moneyInputToMinor } from "@/features/catalog/catalog-money";
import type { AdvancedSalesResult } from "@/features/advanced-sales/advanced-sales-types";
import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

async function database() {
  const supabase = await createClient();
  return supabase as unknown as { from: (table: string) => any };
}

export async function createDiscount(
  context: BusinessContext,
  input: unknown,
): Promise<AdvancedSalesResult> {
  const value = input as { name?: string; type?: string; value?: string };
  const name = value.name?.trim() ?? "";
  const type = value.type === "fixed_amount" ? "fixed_amount" : "percentage";
  if (!name || name.length > 100) return { ok: false, message: "Enter a discount name up to 100 characters." };
  const numeric = Number(value.value);
  if (!Number.isFinite(numeric) || numeric <= 0) return { ok: false, message: "Enter a discount value greater than zero." };
  const record = type === "percentage"
    ? { organization_id: context.organization.id, name, discount_type: type, percentage_bps: Math.round(numeric * 100), amount_minor: null }
    : { organization_id: context.organization.id, name, discount_type: type, percentage_bps: null, amount_minor: moneyInputToMinor(String(value.value)) };
  if (type === "percentage" && (record.percentage_bps ?? 0) > 10_000) return { ok: false, message: "Percentage discounts cannot exceed 100%." };
  if (type === "fixed_amount" && (!record.amount_minor || record.amount_minor <= 0)) return { ok: false, message: "Enter a valid fixed amount." };
  const db = await database();
  const { error } = await db.from("discounts").insert(record);
  if (error) return { ok: false, message: error.code === "23505" ? "That discount name is already in use." : "TINDIO could not create this discount." };
  return { ok: true, message: "Discount created." };
}

export async function createTaxRate(
  context: BusinessContext,
  input: unknown,
): Promise<AdvancedSalesResult> {
  const value = input as { name?: string; rate?: string; inclusive?: boolean; isDefault?: boolean };
  const name = value.name?.trim() ?? ""; const rate = Number(value.rate);
  if (!name || name.length > 100 || !Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, message: "Enter a tax name and a rate from 0 to 100%." };
  const db = await database();
  if (value.isDefault) await db.from("tax_rates").update({ is_default: false }).eq("organization_id", context.organization.id);
  const { error } = await db.from("tax_rates").insert({ organization_id: context.organization.id, name, rate_bps: Math.round(rate * 100), is_inclusive: Boolean(value.inclusive), is_default: Boolean(value.isDefault) });
  if (error) return { ok: false, message: error.code === "23505" ? "That tax name is already in use." : "TINDIO could not create this tax rate." };
  return { ok: true, message: "Tax rate created." };
}

export async function createDiningOption(
  context: BusinessContext,
  input: unknown,
): Promise<AdvancedSalesResult> {
  const value = input as { name?: string; isDefault?: boolean }; const name = value.name?.trim() ?? "";
  if (!name || name.length > 60) return { ok: false, message: "Enter a dining option up to 60 characters." };
  const db = await database();
  if (value.isDefault) await db.from("dining_options").update({ is_default: false }).eq("organization_id", context.organization.id);
  const { error } = await db.from("dining_options").insert({ organization_id: context.organization.id, name, is_default: Boolean(value.isDefault) });
  if (error) return { ok: false, message: error.code === "23505" ? "That dining option already exists." : "TINDIO could not create this dining option." };
  return { ok: true, message: "Dining option created." };
}

export async function createTicketTemplate(
  context: BusinessContext,
  input: unknown,
): Promise<AdvancedSalesResult> {
  const value = input as { label?: string; note?: string; diningOptionId?: string | null };
  const label = value.label?.trim() ?? "";
  const note = value.note?.trim() || null;
  const diningOptionId = value.diningOptionId || null;
  if (!label || label.length > 100 || (note && note.length > 500)) {
    return { ok: false, message: "Enter a template name up to 100 characters and an optional note up to 500." };
  }

  const db = await database();
  if (diningOptionId) {
    const { data: option, error: optionError } = await db
      .from("dining_options")
      .select("id")
      .eq("organization_id", context.organization.id)
      .eq("id", diningOptionId)
      .eq("is_active", true)
      .maybeSingle();
    if (optionError || !option) return { ok: false, message: "Choose an active dining option for this template." };
  }

  const { error } = await db.from("ticket_templates").insert({
    organization_id: context.organization.id,
    created_by_employee_id: context.employee.id,
    label,
    note,
    dining_option_id: diningOptionId,
  });
  if (error) return { ok: false, message: error.code === "23505" ? "That ticket template already exists." : "TINDIO could not create this ticket template." };

  return { ok: true, message: "Ticket template created." };
}

export async function createModifierGroup(
  context: BusinessContext,
  input: unknown,
): Promise<AdvancedSalesResult> {
  const value = input as { name?: string; min?: number; max?: number; options?: Array<{ name: string; price: string }>; productIds?: string[] };
  const name = value.name?.trim() ?? ""; const min = Number(value.min); const max = Number(value.max);
  const options = (value.options ?? []).map((option) => ({ name: option.name.trim(), price: moneyInputToMinor(option.price) }));
  if (!name || name.length > 100 || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < 1 || min > max || max > 50 || options.length === 0 || options.some((option) => !option.name || option.price === null || option.price < 0)) return { ok: false, message: "Enter a valid group, selection limits, and at least one option." };
  const db = await database();
  const { data: group, error } = await db.from("modifier_groups").insert({ organization_id: context.organization.id, name, min_selections: min, max_selections: max }).select("id").single();
  if (error || !group) return { ok: false, message: "TINDIO could not create this modifier group." };
  const [optionsResult, assignmentsResult] = await Promise.all([
    db.from("modifier_options").insert(options.map((option, index) => ({ organization_id: context.organization.id, modifier_group_id: group.id, name: option.name, price_adjustment_minor: option.price, sort_order: index }))),
    (value.productIds?.length ?? 0) > 0 ? db.from("product_modifier_groups").insert(value.productIds!.map((productId, index) => ({ organization_id: context.organization.id, product_id: productId, modifier_group_id: group.id, sort_order: index }))) : Promise.resolve({ error: null }),
  ]);
  if (optionsResult.error || assignmentsResult.error) return { ok: false, message: "The group was created, but not every option or product assignment was saved." };
  return { ok: true, message: "Modifier group created." };
}
