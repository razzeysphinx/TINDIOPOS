import { redirect } from "next/navigation";
import { connection } from "next/server";

import { ShiftWorkspacePage } from "@/app/(back-office)/back-office/shifts/page";
import { loadPosWorkspace } from "@/features/pos/data";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import { canAccessBackOffice, getPosNavigationCapabilities, getWorkspaceHome, hasAnyPermission, hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Shift controls" };

/** Operational shift controls belong to the POS workspace, not Back Office. */
export default async function PosShiftsPage() {
  await connection();
  const context = await requireBusinessContext();

  if (!hasPermission(context, "pos.access") || !hasAnyPermission(context, ["shifts.open", "shifts.close", "cash.pay_in", "cash.pay_out", "settings.manage"])) {
    redirect(getWorkspaceHome(context));
  }
  const workspace = await loadPosWorkspace(context);

  return (
    <main className="min-h-svh bg-muted/35">
      <PosWorkspaceHeader
        canAccessBackOffice={canAccessBackOffice(context)}
        canReceiveIncomingTransfers={workspace.canReceiveIncomingTransfers}
        {...getPosNavigationCapabilities(context)}
        canUseTimeClock={context.features.time_clock}
        employeeName={context.profile.full_name || context.profile.email || "Cashier"}
        incomingTransfers={workspace.incomingTransfers}
        organizationName={context.organization.name}
        scope={`${context.organization.id}:${context.user.id}`}
        stores={workspace.stores}
        timeClockEntry={workspace.timeClockEntry}
        timezone={context.organization.timezone}
        title="Shift"
      />
      <div className="mx-auto w-full max-w-7xl px-4 py-7 sm:px-6 lg:px-8">
        <ShiftWorkspacePage mode="operations" operationalWorkspace="pos" />
      </div>
    </main>
  );
}
