import { Settings2 } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { BusinessProfileManager } from "@/features/business-profile/business-profile-manager";
import { BackupRecoveryManager } from "@/features/organization-recovery/backup-recovery-manager";
import { loadOrganizationRecoverySnapshot } from "@/features/organization-recovery/data";
import { TenantReadinessManager } from "@/features/organization-readiness/tenant-readiness-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Business profile" };

export default async function BusinessProfilePage() {
  const context = await requireBackOfficePermission([
    "settings.manage",
    "organization.manage",
    "organization.export",
    "organization.archive",
    "organization.lifecycle",
    "recovery.view",
    "recovery.manage",
  ]);
  const canManage = hasPermission(context, "settings.manage");
  const recoverySnapshot = context.tenantReadiness.canViewRecovery
    ? await loadOrganizationRecoverySnapshot(context.organization.id)
    : null;

  return (
    <div className="space-y-8">
      <PageHeader
        action={<Badge variant={canManage ? "secondary" : "outline"}><Settings2 aria-hidden="true" />{canManage ? "Settings access" : "View access"}</Badge>}
        description="Review your business type and optional tools. Changes affect future use only; your existing records stay intact."
        eyebrow="Organization settings"
        title="Business profile & features"
      />
      <BusinessProfileManager
        canManage={canManage}
        initialBusinessType={context.organization.business_type}
        initialFeatures={context.features}
      />
      {(context.tenantReadiness.canManageLifecycle || context.tenantReadiness.canExport || context.tenantReadiness.canViewRecovery) ? <details className="group rounded-xl border bg-card">
        <summary className="cursor-pointer list-none px-5 py-4 font-medium marker:hidden">Advanced organization controls <span className="ml-2 text-sm font-normal text-muted-foreground">Lifecycle, exports, and recovery</span></summary>
        <div className="space-y-6 border-t p-5">
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
          <BackupRecoveryManager
            canExport={context.tenantReadiness.canExport}
            canManageRecovery={context.tenantReadiness.canManageRecovery}
            canViewRecovery={context.tenantReadiness.canViewRecovery}
            initialSnapshot={recoverySnapshot}
            organizationId={context.organization.id}
          />
        </div>
      </details> : null}
    </div>
  );
}
