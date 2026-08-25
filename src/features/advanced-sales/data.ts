import "server-only";

import type { BusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type AdvancedSalesConfig = {
  products: Array<{ id: string; name: string }>;
  ticketTemplates: Array<{ id: string; label: string; note: string | null; diningOptionId: string | null }>;
  diningOptions: Array<{ id: string; name: string }>;
};

export async function loadAdvancedSalesConfig(
  context: BusinessContext,
): Promise<AdvancedSalesConfig> {
  const supabase = await createClient();
  const [productsResult, templatesResult, diningResult] = await Promise.all([
    supabase.from("products").select("id, name").eq("organization_id", context.organization.id).eq("status", "active").order("name"),
    supabase.from("ticket_templates").select("id, label, note, dining_option_id").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order").order("label"),
    supabase.from("dining_options").select("id, name").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order").order("name"),
  ]);
  const error = [productsResult, templatesResult, diningResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load advanced sales settings: ${error.message}`);

  return {
    products: productsResult.data ?? [],
    ticketTemplates: (templatesResult.data ?? []).map((template) => ({ id: template.id, label: template.label, note: template.note, diningOptionId: template.dining_option_id })),
    diningOptions: diningResult.data ?? [],
  };
}
