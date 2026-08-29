import { connection } from "next/server";
import { redirect } from "next/navigation";

import { loadPosWorkspace } from "@/features/pos/data";
import { PosItemsWorkspace } from "@/features/pos/pos-items-workspace";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import { canAccessBackOffice, getPosNavigationCapabilities, getWorkspaceHome, hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "POS items" };

export default async function PosItemsPage() {
  await connection();
  const context = await requireBusinessContext();
  if (!hasPermission(context, "pos.access")) redirect(getWorkspaceHome(context));
  const workspace = await loadPosWorkspace(context);

  return (
    <main className="min-h-svh bg-background">
      <PosWorkspaceHeader
        canAccessBackOffice={canAccessBackOffice(context)}
        {...getPosNavigationCapabilities(context)}
        canUseTimeClock={context.features.time_clock}
        employeeName={context.profile.full_name || context.profile.email || "Cashier"}
        organizationName={context.organization.name}
        scope={`${context.organization.id}:${context.user.id}`}
        stores={workspace.stores}
        timeClockEntry={workspace.timeClockEntry}
        timezone={context.organization.timezone}
        title="Items"
      />
      <section className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
        <div><p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Operational catalog</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Items</h1><p className="mt-2 text-sm text-muted-foreground">Browse current sellable items and selling options. Product, category, modifier, and discount administration remains in Back Office.</p></div>
        <PosItemsWorkspace canApplyDiscounts={hasPermission(context, "discounts.apply")} categories={workspace.categories} currencyCode={context.organization.currency_code} discounts={workspace.discounts} items={workspace.initialItems} />
      </section>
    </main>
  );
}
