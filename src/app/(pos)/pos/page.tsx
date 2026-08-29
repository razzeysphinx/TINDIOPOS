import { connection } from "next/server";
import { redirect } from "next/navigation";

import { loadPosWorkspace } from "@/features/pos/data";
import { PosTerminal } from "@/features/pos/pos-terminal";
import {
  canAccessBackOffice,
  getPosNavigationCapabilities,
  getWorkspaceHome,
  hasAnyPermission,
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

  const features = context.features;
  const workspace = await loadPosWorkspace(context);
  const canAssignTickets = hasPermission(context, "employees.manage");
  const navigationCapabilities = getPosNavigationCapabilities(context);
  const activeShift = workspace.activeShift;

  return (
    <PosTerminal
      activeShift={activeShift}
      canAccessBackOffice={canAccessBackOffice(context)}
      canAcceptPayments={hasPermission(context, "payments.accept")}
      canApplyDiscounts={hasPermission(context, "discounts.apply")}
      canCloseShift={hasPermission(context, "shifts.close")}
      canEditQuantity={hasPermission(context, "pos.edit_quantity")}
      canOpenShift={hasPermission(context, "shifts.open")}
      canUseShiftControls={hasAnyPermission(context, [
        "shifts.open",
        "shifts.close",
        "cash.pay_in",
        "cash.pay_out",
        "settings.manage",
      ])}
      canViewReceipts={navigationCapabilities.canViewReceipts}
      canManageTiles={hasPermission(context, "products.manage")}
      canRemoveItems={hasPermission(context, "pos.remove_item")}
      canAssignTickets={canAssignTickets}
      canUseCustomerLoyalty={features.loyalty}
      canUseDining={features.dining}
      canUseOpenTickets={features.open_tickets && hasPermission(context, "tickets.manage")}
      canUseTimeClock={features.time_clock}
      categories={workspace.categories}
      customerDisplaySessions={features.customer_display ? workspace.customerDisplaySessions : []}
      deviceManagementEnabled={context.organization.device_management_enabled}
      diningOptions={features.dining ? workspace.diningOptions : []}
      discounts={hasPermission(context, "discounts.apply") ? workspace.discounts : []}
      currencyCode={context.organization.currency_code}
      employeeName={context.profile.full_name || context.profile.email || "Cashier"}
      initialItems={workspace.initialItems}
      initialFavoriteItems={workspace.initialFavoriteItems}
      initialRecentItems={workspace.initialRecentItems}
      key={`${activeShift?.id ?? "shift-closed"}:${workspace.openTickets.map((ticket) => `${ticket.id}:${ticket.updatedAt}`).join(",")}`}
      loyaltyProgram={features.loyalty ? workspace.loyaltyProgram : null}
      organizationName={context.organization.name}
      openTickets={features.open_tickets ? workspace.openTickets : []}
      offlineScope={`${context.organization.id}:${context.user.id}`}
      organizationId={context.organization.id}
      paymentMethods={workspace.paymentMethods}
      registers={workspace.registers}
      stores={workspace.stores}
      taxRates={workspace.taxRates}
      ticketAssignees={features.open_tickets ? workspace.ticketAssignees : []}
      ticketTemplates={features.open_tickets ? workspace.ticketTemplates : []}
      timeClockEntry={features.time_clock ? workspace.timeClockEntry : null}
      timezone={context.organization.timezone}
    />
  );
}
