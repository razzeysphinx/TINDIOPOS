import { connection } from "next/server";
import { redirect } from "next/navigation";

import { loadPosWorkspace } from "@/features/pos/data";
import { PosTerminal } from "@/features/pos/pos-terminal";
import { getPosCapabilities } from "@/features/pos/pos-capabilities";
import {
  canAccessBackOffice,
  getWorkspaceHome,
  hasPermission,
  requireBusinessContext,
} from "@/lib/auth/dal";

export const metadata = { title: "Point of sale" };

export default async function PosPage() {
  await connection();
  const context = await requireBusinessContext();

  if (!hasPermission(context, "pos.access") || !hasPermission(context, "sales.create")) {
    redirect(getWorkspaceHome(context));
  }

  const workspace = await loadPosWorkspace(context);
  const capabilities = getPosCapabilities({
    businessType: context.organization.business_type,
    features: context.features,
    permissions: context.permissions,
  });
  const activeShift = workspace.activeShift;

  return (
    <PosTerminal
      activeShift={activeShift}
      canAccessBackOffice={canAccessBackOffice(context)}
      {...capabilities}
      categories={workspace.categories}
      customerDisplaySessions={context.features.customer_display ? workspace.customerDisplaySessions : []}
      deviceManagementEnabled={context.organization.device_management_enabled}
      diningOptions={capabilities.canUseDining ? workspace.diningOptions : []}
      discounts={capabilities.canApplyDiscounts ? workspace.discounts : []}
      currencyCode={context.organization.currency_code}
      employeeName={context.profile.full_name || context.profile.email || "Cashier"}
      initialItems={workspace.initialItems}
      initialFavoriteItems={workspace.initialFavoriteItems}
      initialRecentItems={workspace.initialRecentItems}
      key={`${activeShift?.id ?? "shift-closed"}:${workspace.openTickets.map((ticket) => `${ticket.id}:${ticket.updatedAt}`).join(",")}`}
      loyaltyProgram={capabilities.canUseCustomerLoyalty ? workspace.loyaltyProgram : null}
      organizationName={context.organization.name}
      openTickets={capabilities.canUseOpenTickets ? workspace.openTickets : []}
      offlineScope={`${context.organization.id}:${context.user.id}`}
      organizationId={context.organization.id}
      paymentMethods={workspace.paymentMethods}
      registers={workspace.registers}
      stores={workspace.stores}
      taxRates={workspace.taxRates}
      ticketAssignees={capabilities.canUseOpenTickets ? workspace.ticketAssignees : []}
      ticketTemplates={capabilities.canUseOpenTickets ? workspace.ticketTemplates : []}
      timeClockEntry={capabilities.canUseTimeClock ? workspace.timeClockEntry : null}
      timezone={context.organization.timezone}
    />
  );
}
