import "server-only";

import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type AdvancedSalesConfig = {
  products: Array<{ id: string; name: string }>;
  discounts: Array<{ id: string; name: string; type: "percentage" | "fixed_amount"; percentageBps: number | null; amountMinor: number | null; isActive: boolean }>;
  taxRates: Array<{ id: string; name: string; rateBps: number; isInclusive: boolean; isDefault: boolean; isActive: boolean }>;
  ticketTemplates: Array<{ id: string; label: string; note: string | null; diningOptionId: string | null; isActive: boolean }>;
  diningOptions: Array<{ id: string; name: string; isDefault: boolean; isActive: boolean }>;
  modifierGroups: Array<{ id: string; name: string; minSelections: number; maxSelections: number; isActive: boolean }>;
};

export async function loadAdvancedSalesConfig(
  context: BusinessContext,
): Promise<AdvancedSalesConfig> {
  const supabase = await createClient();
  const [productsResult, discountsResult, taxRatesResult, templatesResult, diningResult, modifierGroupsResult] = await Promise.all([
    supabase.from("products").select("id, name").eq("organization_id", context.organization.id).eq("status", "active").order("name"),
    supabase.from("discounts").select("id, name, discount_type, percentage_bps, amount_minor, is_active").eq("organization_id", context.organization.id).order("sort_order").order("name"),
    supabase.from("tax_rates").select("id, name, rate_bps, is_inclusive, is_default, is_active").eq("organization_id", context.organization.id).order("name"),
    supabase.from("ticket_templates").select("id, label, note, dining_option_id, is_active").eq("organization_id", context.organization.id).order("sort_order").order("label"),
    supabase.from("dining_options").select("id, name, is_default, is_active").eq("organization_id", context.organization.id).order("sort_order").order("name"),
    supabase.from("modifier_groups").select("id, name, min_selections, max_selections, is_active").eq("organization_id", context.organization.id).order("name"),
  ]);
  const error = [productsResult, discountsResult, taxRatesResult, templatesResult, diningResult, modifierGroupsResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load advanced sales settings: ${error.message}`);

  return {
    products: productsResult.data ?? [],
    discounts: (discountsResult.data ?? []).map((discount) => ({ id: discount.id, name: discount.name, type: discount.discount_type as "percentage" | "fixed_amount", percentageBps: discount.percentage_bps, amountMinor: discount.amount_minor, isActive: discount.is_active })),
    taxRates: (taxRatesResult.data ?? []).map((taxRate) => ({ id: taxRate.id, name: taxRate.name, rateBps: taxRate.rate_bps, isInclusive: taxRate.is_inclusive, isDefault: taxRate.is_default, isActive: taxRate.is_active })),
    ticketTemplates: (templatesResult.data ?? []).map((template) => ({ id: template.id, label: template.label, note: template.note, diningOptionId: template.dining_option_id, isActive: template.is_active })),
    diningOptions: (diningResult.data ?? []).map((option) => ({ id: option.id, name: option.name, isDefault: option.is_default, isActive: option.is_active })),
    modifierGroups: (modifierGroupsResult.data ?? []).map((group) => ({ id: group.id, name: group.name, minSelections: group.min_selections, maxSelections: group.max_selections, isActive: group.is_active })),
  };
}
