import { PageHeader } from "@/components/back-office/page-header";
import { loadAdvancedSalesConfig } from "@/features/advanced-sales/data";
import { AdvancedSalesManager } from "@/features/advanced-sales/advanced-sales-manager";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Advanced sales" };
export default async function AdvancedSalesPage() {
  const context = await requireBusinessContext();
  const config = await loadAdvancedSalesConfig(context);

  return <div className="space-y-8"><PageHeader eyebrow="Sales settings" title="Advanced sales" description="Set discounts, tax handling, dining options, ticket templates, and product modifiers for the POS."/><AdvancedSalesManager canManage={hasPermission(context,"products.manage")} diningOptions={config.diningOptions} features={context.features} products={config.products} ticketTemplates={config.ticketTemplates}/></div>;
}
