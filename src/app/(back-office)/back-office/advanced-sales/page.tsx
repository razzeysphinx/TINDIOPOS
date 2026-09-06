import { PageHeader } from "@/components/back-office/page-header";
import { loadAdvancedSalesConfig } from "@/features/advanced-sales/data";
import { AdvancedSalesManager } from "@/features/advanced-sales/advanced-sales-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Discounts & Taxes" };
export default async function AdvancedSalesPage() {
  const context = await requireBackOfficePermission("products.manage");
  const config = await loadAdvancedSalesConfig(context);

  return <div className="space-y-8"><PageHeader eyebrow="Sales settings" title="Discounts & Taxes" description="Configure the discounts and tax rates used during sales."/><AdvancedSalesManager canManage={hasPermission(context,"products.manage")} diningOptions={config.diningOptions} discounts={config.discounts} features={context.features} modifierGroups={config.modifierGroups} products={config.products} taxRates={config.taxRates} ticketTemplates={config.ticketTemplates}/></div>;
}
