import { connection } from "next/server";
import { redirect } from "next/navigation";

import { loadPosWorkspace } from "@/features/pos/data";
import { PosSettingsWorkspace } from "@/features/pos/pos-settings-workspace";
import { PosWorkspaceHeader } from "@/features/pos/pos-workspace-header";
import { canAccessBackOffice, getWorkspaceHome, hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "POS settings" };

export default async function PosSettingsPage() {
  await connection();
  const context = await requireBusinessContext();
  if (!hasPermission(context, "sales.create")) redirect(getWorkspaceHome(context));
  const workspace = await loadPosWorkspace(context);

  return (
    <main className="min-h-svh bg-background">
      <PosWorkspaceHeader
        canAccessBackOffice={canAccessBackOffice(context)}
        canUseTimeClock={context.features.time_clock}
        employeeName={context.profile.full_name || context.profile.email || "Cashier"}
        organizationName={context.organization.name}
        scope={`${context.organization.id}:${context.user.id}`}
        stores={workspace.stores}
        timeClockEntry={workspace.timeClockEntry}
        timezone={context.organization.timezone}
        title="Settings"
      />
      <section className="mx-auto w-full max-w-5xl space-y-5 p-4 sm:p-6 lg:p-8">
        <div><p className="text-xs font-semibold tracking-[0.12em] text-primary uppercase">Device preferences</p><h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">POS settings</h1><p className="mt-2 text-sm text-muted-foreground">Only local operating preferences are available here. Business configuration remains protected in Back Office.</p></div>
        <PosSettingsWorkspace scope={`${context.organization.id}:${context.user.id}`} />
      </section>
    </main>
  );
}
