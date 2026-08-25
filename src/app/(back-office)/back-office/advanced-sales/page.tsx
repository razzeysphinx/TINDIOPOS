import { PageHeader } from "@/components/back-office/page-header";
import { AdvancedSalesManager } from "@/features/advanced-sales/advanced-sales-manager";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Advanced sales" };
export default async function AdvancedSalesPage() {
  const context = await requireBusinessContext();
  const supabase = await createClient();
  const [productsResult, templatesResult, diningResult] = await Promise.all([
    supabase.from("products").select("id, name").eq("organization_id", context.organization.id).eq("status", "active").order("name"),
    supabase.from("ticket_templates").select("id, label, note, dining_option_id").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order").order("label"),
    supabase.from("dining_options").select("id, name").eq("organization_id", context.organization.id).eq("is_active", true).order("sort_order").order("name"),
  ]);
  const error = [productsResult, templatesResult, diningResult].find((result) => result.error)?.error;
  if (error) throw new Error(`Unable to load advanced sales settings: ${error.message}`);

  return <div className="space-y-8"><PageHeader eyebrow="Sales settings" title="Advanced sales" description="Set discounts, tax handling, dining options, ticket templates, and product modifiers for the POS."/><AdvancedSalesManager canManage={hasPermission(context,"products.manage")} diningOptions={diningResult.data ?? []} features={context.features} products={productsResult.data ?? []} ticketTemplates={(templatesResult.data ?? []).map((template) => ({ id: template.id, label: template.label, note: template.note, diningOptionId: template.dining_option_id }))}/></div>;
}
