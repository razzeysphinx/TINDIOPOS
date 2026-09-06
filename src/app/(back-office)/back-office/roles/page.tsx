import { ChevronDown, KeyRound, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { GuardedDeleteDialog } from "@/components/back-office/guarded-delete-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRoleForm, EditRoleButton } from "@/features/management/management-forms";
import { loadManagementRoles } from "@/features/management/data";
import type {
  ManagementPermissionRow,
  ManagementRolePermissionRow,
  ManagementRoleRow,
} from "@/features/management/management-types";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Roles & Access" };

export default async function RolesPage() {
  const context = await requireBackOfficePermission("roles.manage");
  const { roles, rolePermissions, permissions } = await loadManagementRoles(context);
  const permissionDetails = new Map(
    permissions.map((permission) => [permission.code, permission]),
  );
  const canManage = hasPermission(context, "roles.manage");
  const grantablePermissions = permissions.filter((permission) =>
    context.permissions.includes(permission.code),
  );
  const systemRoles = roles.filter((role) => role.is_system);
  const customRoles = roles.filter((role) => !role.is_system);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Roles & Access"
        description="Choose what each role can do and review the permissions included with it."
        action={canManage ? <CreateRoleForm permissions={grantablePermissions} /> : undefined}
      />

      <RoleGroup
        canManage={canManage}
        description="These ready-made roles are safe starting points for your team. Their included access is protected and cannot be changed."
        grantablePermissions={grantablePermissions}
        permissionDetails={permissionDetails}
        rolePermissions={rolePermissions}
        roles={systemRoles}
        title="READY-MADE ROLES"
      />
      <RoleGroup
        canManage={canManage}
        description="Create a custom role only when the ready-made roles do not match how your business works."
        emptyMessage="No custom roles yet. Use a ready-made role unless your business needs a different combination of access."
        grantablePermissions={grantablePermissions}
        permissionDetails={permissionDetails}
        rolePermissions={rolePermissions}
        roles={customRoles}
        title="CUSTOM ROLES"
      />
    </div>
  );
}

function RoleGroup({
  canManage,
  description,
  emptyMessage,
  grantablePermissions,
  permissionDetails,
  rolePermissions,
  roles,
  title,
}: {
  canManage: boolean;
  description: string;
  emptyMessage?: string;
  grantablePermissions: ManagementPermissionRow[];
  permissionDetails: Map<string, ManagementPermissionRow>;
  rolePermissions: ManagementRolePermissionRow[];
  roles: ManagementRoleRow[];
  title: string;
}) {
  const titleId = `${title.toLowerCase().replaceAll(" ", "-")}-title`;

  return (
    <section aria-labelledby={titleId}>
      <div className="mb-3">
        <h2 className="text-xs font-bold tracking-[0.14em] text-primary uppercase" id={titleId}>
          {title}
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {roles.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {roles.map((role) => {
          const rolePermissionDetails = rolePermissions
            .filter((permission) => permission.role_id === role.id)
            .map((permission) => permissionDetails.get(permission.permission_code))
            .filter(
              (
                permission,
              ): permission is { code: string; name: string; category: string } =>
                Boolean(permission),
            );
          const rolePermissionCodes = rolePermissions
            .filter((permission) => permission.role_id === role.id)
            .map((permission) => permission.permission_code);

            return (
              <Card key={role.id}>
              <CardHeader className="flex-row items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                    <ShieldCheck className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <CardTitle>{role.name}</CardTitle>
                  </div>
                </div>
                {role.is_system ? <Badge variant="outline">TINDIO preset</Badge> : null}
              </CardHeader>
              <CardContent>
                <p className="min-h-10 text-sm leading-6 text-muted-foreground">
                  {role.description || "No role description."}
                </p>
                <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-sm font-medium">
                  <KeyRound className="size-4 text-primary" aria-hidden="true" />
                  Includes {rolePermissionDetails.length} access setting
                  {rolePermissionDetails.length === 1 ? "" : "s"}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {rolePermissionDetails.slice(0, 6).map((permission) => (
                    <Badge key={permission.code} variant="secondary">
                      {permission.name}
                    </Badge>
                  ))}
                  {rolePermissionDetails.length > 6 ? (
                    <details className="group">
                      <summary className="cursor-pointer list-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted">
                          Show {rolePermissionDetails.length - 6} more permissions
                          <ChevronDown
                            aria-hidden="true"
                            className="size-3.5 transition-transform group-open:rotate-180"
                          />
                        </span>
                      </summary>
                      <div
                        aria-label={`Remaining permissions for ${role.name}`}
                        className="mt-3 rounded-lg border bg-muted/30 p-3"
                        role="region"
                      >
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Remaining permissions for {role.name}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {rolePermissionDetails.slice(6).map((permission) => (
                            <Badge key={permission.code} variant="secondary">
                              {permission.name}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </details>
                  ) : null}
                </div>
                {canManage && !role.is_system ? (
                  <div className="mt-4 flex justify-end border-t pt-3">
                    <EditRoleButton
                      permissions={grantablePermissions}
                      role={{
                        id: role.id,
                        name: role.name,
                        code: role.code,
                        description: role.description,
                        permissionCodes: rolePermissionCodes,
                      }}
                    />
                    <GuardedDeleteDialog
                      recordId={role.id}
                      recordName={role.name}
                      recordType="custom_role"
                    />
                  </div>
                ) : null}
              </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="py-5 text-sm text-muted-foreground">
            {emptyMessage ?? "No roles are available in this organization."}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
