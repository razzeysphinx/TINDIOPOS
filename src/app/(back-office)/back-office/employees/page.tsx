import { Building2, Clock3, IdCard, ShieldCheck, UserRound } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  CreateInvitationForm,
  RevokeInvitationButton,
} from "@/features/management/management-forms";
import { EmployeePinForm } from "@/features/approvals/employee-pin-form";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Employees" };

export default async function EmployeesPage() {
  const context = await requireBusinessContext();
  const supabase = await createClient();
  const organizationId = context.organization.id;
  const canManage = hasPermission(context, "employees.manage");
  const employeeResult = await supabase
    .from("employees")
    .select("id, profile_id, employee_number, job_title, status, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: true });

  if (employeeResult.error) {
    throw new Error(`Unable to load employees: ${employeeResult.error.message}`);
  }

  const employeeIds = employeeResult.data.map((employee) => employee.id);
  const profileIds = employeeResult.data.map((employee) => employee.profile_id);
  const [
    profilesResult,
    roleLinksResult,
    storeLinksResult,
    rolesResult,
    storesResult,
    rolePermissionsResult,
    invitationsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email").in("id", profileIds),
    supabase
      .from("employee_roles")
      .select("employee_id, role_id")
      .eq("organization_id", organizationId)
      .in("employee_id", employeeIds),
    supabase
      .from("employee_stores")
      .select("employee_id, store_id")
      .eq("organization_id", organizationId)
      .in("employee_id", employeeIds),
    supabase.from("roles").select("id, name").eq("organization_id", organizationId),
    supabase
      .from("stores")
      .select("id, name, is_active")
      .eq("organization_id", organizationId),
    supabase
      .from("role_permissions")
      .select("role_id, permission_code")
      .eq("organization_id", organizationId),
    canManage
      ? supabase
          .from("employee_invitations")
          .select(
            "id, email, employee_number, job_title, role_name_snapshot, store_name_snapshot, expires_at, accepted_at, revoked_at, created_at",
          )
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = [
    profilesResult,
    roleLinksResult,
    storeLinksResult,
    rolesResult,
    storesResult,
    rolePermissionsResult,
    invitationsResult,
  ].find((result) => result.error)?.error;

  if (error) {
    throw new Error(`Unable to load employee assignments: ${error.message}`);
  }

  const profilesData = profilesResult.data ?? [];
  const roleLinks = roleLinksResult.data ?? [];
  const storeLinks = storeLinksResult.data ?? [];
  const rolesData = rolesResult.data ?? [];
  const storesData = storesResult.data ?? [];
  const rolePermissions = rolePermissionsResult.data ?? [];
  const invitations = invitationsResult.data ?? [];
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Employees"
        description="Employee records connect verified identities to organization roles and explicit store assignments."
        action={
          <Badge variant={canManage ? "secondary" : "outline"}>
            {canManage ? "Management access" : "Your record only"}
          </Badge>
        }
      />

      {canManage && grantableRoles.length > 0 && activeStores.length > 0 ? (
        <CreateInvitationForm roles={grantableRoles} stores={activeStores} />
      ) : null}

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
          <div className="grid gap-3 lg:grid-cols-2">
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

      <section className="grid gap-4 lg:grid-cols-2">
        {employeeResult.data.map((employee) => {
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
            <Card key={employee.id}>
              <CardHeader className="flex-row items-start justify-between">
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
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IdCard className="size-4" aria-hidden="true" />
                  <span className="font-mono text-xs">{employee.employee_number}</span>
                  <span>·</span>
                  <span>{employee.job_title || "No job title"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {employeeRoles.map((role) => (
                    <Badge key={role} variant="outline">
                      {role}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Building2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  {employeeStores.join(", ") || "No store assignment"}
                </div>
                {canManage || employee.id === context.employee.id ? (
                  <EmployeePinForm
                    employeeId={employee.id}
                    employeeName={profile?.full_name || employee.employee_number}
                  />
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
