import { Building2, Clock3, Eye, IdCard, Search, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CreateInvitationForm,
  RevokeInvitationButton,
} from "@/features/management/management-forms";
import { loadManagementEmployees } from "@/features/management/data";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Employees" };

function formatStoreAssignment(storeNames: string[]) {
  if (storeNames.length === 0) return "No store assignment";
  if (storeNames.length <= 3) return storeNames.join(", ");
  return `${storeNames.slice(0, 3).join(", ")} +${storeNames.length - 3} more`;
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; q?: string; status?: string }>;
}) {
  const context = await requireBackOfficePermission("employees.manage");
  const parameters = await searchParams;
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();
  const canManage = hasPermission(context, "employees.manage");
  const {
    employees,
    profiles: profilesData,
    roleLinks,
    storeLinks,
    roles: rolesData,
    stores: storesData,
    rolePermissions,
    invitations,
  } = await loadManagementEmployees(context, { includeInvitations: canManage });
  const authorizedStores = await loadAuthorizedBackOfficeStores(context);

  const profiles = new Map(profilesData.map((profile) => [profile.id, profile]));
  const roles = new Map(rolesData.map((role) => [role.id, role.name]));
  const stores = new Map(storesData.map((store) => [store.id, store.name]));
  const grantableRoles = rolesData.filter((role) =>
    rolePermissions
      .filter((permission) => permission.role_id === role.id)
      .every((permission) => context.permissions.includes(permission.permission_code)),
  );
  const activeStores = storesData.filter((store) => store.is_active);
  const pendingInvitations = invitations.filter(
    (invitation) => !invitation.accepted_at && !invitation.revoked_at,
  );
  const selectedStatus = ["active", "inactive", "archived"].includes(parameters.status ?? "") ? parameters.status! : "active";
  const query = parameters.q?.trim().toLocaleLowerCase() ?? "";
  const scopedEmployees = storeScope.selectedStoreId
    ? employees.filter((employee) => storeLinks.some((link) => link.employee_id === employee.id && link.store_id === storeScope.selectedStoreId))
    : employees;
  const visibleEmployees = scopedEmployees.filter((employee) => {
    const statusMatches = selectedStatus === "inactive" ? ["inactive", "suspended"].includes(employee.status) : employee.status === selectedStatus;
    const profile = profiles.get(employee.profile_id);
    const searchMatches = !query || `${profile?.full_name ?? ""} ${profile?.email ?? ""} ${employee.employee_number} ${employee.job_title ?? ""}`.toLocaleLowerCase().includes(query);
    return statusMatches && searchMatches;
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Employees"
        description="Invite your team, choose what they can do, and select the stores where they can work."
        action={canManage && grantableRoles.length > 0 && activeStores.length > 0 ? (
          <CreateInvitationForm roles={grantableRoles} stores={activeStores} />
        ) : undefined}
      />
      <GlobalFilterBar action="/back-office/employees" namePrefix="employee-filter" showDateRange={false} storeId={storeScope.selectedStoreId} stores={authorizedStores} />
      <form action="/back-office/employees" className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row">
        {storeScope.selectedStoreId ? <input name="store" type="hidden" value={storeScope.selectedStoreId} /> : null}
        <label className="relative flex-1"><span className="sr-only">Search employees</span><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" /><Input className="pl-9" defaultValue={parameters.q} name="q" placeholder="Search employees..." /></label>
        <div className="flex gap-2" role="group" aria-label="Employee status">
          {[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "archived", label: "Archived" }].map((option) => <button className={buttonVariants({ variant: selectedStatus === option.value ? "default" : "outline", size: "sm" })} key={option.value} name="status" type="submit" value={option.value}>{option.label}</button>)}
        </div>
      </form>

      {canManage && pendingInvitations.length > 0 ? (
        <section className="space-y-3" aria-labelledby="pending-invitations-title">
          <div>
            <h2 className="text-lg font-semibold" id="pending-invitations-title">
              Pending invitations
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Invitation links expire automatically after seven days.
            </p>
          </div>
          <div className="grid gap-3">
            {pendingInvitations.map((invitation) => {
              return (
                <Card key={invitation.id} size="sm">
                  <CardHeader className="flex-row items-start justify-between">
                    <div className="min-w-0">
                      <CardTitle className="truncate">{invitation.email}</CardTitle>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {invitation.employee_number}
                      </p>
                    </div>
                    <RevokeInvitationButton invitationId={invitation.id} />
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <p className="flex items-center gap-2">
                      <ShieldCheck className="size-4" aria-hidden="true" />
                      {invitation.role_name_snapshot}
                    </p>
                    <p className="flex items-center gap-2">
                      <Building2 className="size-4" aria-hidden="true" />
                      {invitation.store_name_snapshot}
                    </p>
                    <p className="flex items-center gap-2 sm:col-span-2">
                      <Clock3 className="size-4" aria-hidden="true" />
                      Expires{" "}
                      {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
                        new Date(invitation.expires_at),
                      )}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {visibleEmployees.length > 0 ? (
        <section aria-label="Employees" className="overflow-hidden rounded-2xl border bg-card">
          {visibleEmployees.map((employee) => {
          const profile = profiles.get(employee.profile_id);
          const employeeRoles = roleLinks
            .filter((link) => link.employee_id === employee.id)
            .map((link) => roles.get(link.role_id))
            .filter((role): role is string => Boolean(role));
          const employeeStores = storeLinks
            .filter((link) => link.employee_id === employee.id)
            .map((link) => stores.get(link.store_id))
            .filter((store): store is string => Boolean(store));
            return (
            <Card className="gap-4 rounded-none border-b py-4 ring-0 last:border-b-0 sm:grid sm:grid-cols-[minmax(0,1.45fr)_minmax(10rem,0.85fr)_minmax(10rem,0.8fr)_auto] sm:items-center" key={employee.id}>
              <CardHeader className="flex-row items-start justify-between px-4 sm:px-0">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                    <UserRound className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate">
                      {profile?.full_name || "Unnamed employee"}
                    </CardTitle>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {profile?.email || "Email unavailable"}
                    </p>
                  </div>
                </div>
                <Badge variant={employee.status === "active" ? "secondary" : "outline"}>
                  {employee.status}
                </Badge>
              </CardHeader>
              <CardContent className="grid gap-3 px-4 sm:col-span-3 sm:grid-cols-[minmax(10rem,0.85fr)_minmax(10rem,0.8fr)_auto] sm:items-center sm:px-0">
                <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
                  <IdCard className="size-4" aria-hidden="true" />
                  <span className="shrink-0 font-mono text-xs">{employee.employee_number}</span>
                  <span className="shrink-0">·</span>
                  <span className="min-w-0 truncate" title={employee.job_title || employeeRoles.join(", ") || "No role assigned"}>{employee.job_title || employeeRoles.join(", ") || "No role assigned"}</span>
                </div>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span className="truncate" title={employeeStores.join(", ")}>{formatStoreAssignment(employeeStores)}</span>
                </div>
                <div className="flex justify-end border-t pt-3 sm:border-t-0 sm:pt-0"><Link aria-label={`View ${profile?.full_name || employee.employee_number}`} className={buttonVariants({ variant: "ghost", size: "sm" })} href={`/back-office/employees/${employee.id}`}><Eye />View</Link></div>
              </CardContent>
            </Card>
            );
          })}
        </section>
      ) : (
        <BackOfficeStateCard
          action={canManage && grantableRoles.length > 0 && activeStores.length > 0 ? <CreateInvitationForm roles={grantableRoles} stores={activeStores} /> : null}
          description="Invite a team member once the appropriate role and active store are available."
          icon={<UserRound className="size-5" aria-hidden="true" />}
          title="No employees yet"
        />
      )}
    </div>
  );
}
