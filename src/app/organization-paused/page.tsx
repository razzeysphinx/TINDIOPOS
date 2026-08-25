import { Building2, ShieldAlert } from "lucide-react";
import { connection } from "next/server";
import { redirect } from "next/navigation";

import { TindioMark } from "@/components/brand/tindio-mark";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/features/auth/actions";
import { BackupRecoveryManager } from "@/features/organization-recovery/backup-recovery-manager";
import { loadOrganizationRecoverySnapshot } from "@/features/organization-recovery/data";
import { OrganizationSwitcher } from "@/features/organization-readiness/organization-switcher";
import { TenantReadinessManager } from "@/features/organization-readiness/tenant-readiness-manager";
import { getBusinessContext, requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Organization paused" };

export default async function OrganizationPausedPage() {
  await connection();
  await requireUser();
  const context = await getBusinessContext();

  if (!context) {
    redirect("/onboarding");
  }

  if (context.organization.status === "active") {
    redirect("/back-office");
  }

  const recoverySnapshot = context.tenantReadiness.canViewRecovery
    ? await loadOrganizationRecoverySnapshot(context.organization.id)
    : null;

  return (
    <main className="min-h-svh bg-muted/45 px-5 py-8 sm:px-8 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <TindioMark />
          <div className="flex items-center gap-2">
            <OrganizationSwitcher
              organizations={context.availableOrganizations}
              selectedOrganizationId={context.organization.id}
            />
            <form action={signOutAction}>
              <Button size="sm" type="submit" variant="outline">Sign out</Button>
            </form>
          </div>
        </header>

        <section className="mt-12 max-w-3xl">
          <p className="flex items-center gap-2 text-sm font-bold tracking-[0.14em] text-primary uppercase">
            <ShieldAlert aria-hidden="true" className="size-4" />Organization lifecycle
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
            {context.organization.status === "archived" ? "This business is archived." : "This business is paused."}
          </h1>
          <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
            TINDIO has blocked normal operations for this organization while preserving its records. Switch to another active business, or use the owner controls below to resume or export this tenant safely.
          </p>
        </section>

        <div className="mt-8">
          <TenantReadinessManager
            archiveRequestedAt={context.organization.archive_requested_at}
            canManageLifecycle={context.tenantReadiness.canManageLifecycle}
            canViewUsage={context.tenantReadiness.canExport}
            currencyCode={context.organization.currency_code}
            organizationId={context.organization.id}
            organizationName={context.organization.name}
            status={context.organization.status as "active" | "suspended" | "archived"}
            suspensionReason={context.organization.suspension_reason}
          />
        </div>

        <div className="mt-8">
          <BackupRecoveryManager
            canExport={context.tenantReadiness.canExport}
            canManageRecovery={context.tenantReadiness.canManageRecovery}
            canViewRecovery={context.tenantReadiness.canViewRecovery}
            initialSnapshot={recoverySnapshot}
            organizationId={context.organization.id}
          />
        </div>

        <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 aria-hidden="true" className="size-4" />
          Organization selection is verified against your signed-in membership on every server request.
        </p>
      </div>
    </main>
  );
}
