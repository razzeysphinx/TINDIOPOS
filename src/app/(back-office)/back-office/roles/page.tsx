import { KeyRound, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateRoleForm } from "@/features/management/management-forms";
import { loadManagementRoles } from "@/features/management/data";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Roles and access" };

export default async function RolesPage() {
  const context = await requireBusinessContext();
  const { roles, rolePermissions, permissions } = await loadManagementRoles(context);
  const permissionDetails = new Map(
    permissions.map((permission) => [permission.code, permission]),
  );
  const canManage = hasPermission(context, "roles.manage");
  const grantablePermissions = permissions.filter((permission) =>
    context.permissions.includes(permission.code),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Roles & permissions"
        description="Effective access comes from database-backed role assignments. Interface visibility never replaces RLS enforcement."
        action={
          <Badge variant={canManage ? "secondary" : "outline"}>
            {canManage ? "Management access" : "View access"}
          </Badge>
        }
      />

      {canManage ? <CreateRoleForm permissions={grantablePermissions} /> : null}

      <section className="grid gap-4 lg:grid-cols-2">
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

          return (
            <Card key={role.id}>
              <CardHeader className="flex-row items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                    <ShieldCheck className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <CardTitle>{role.name}</CardTitle>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {role.code}
                    </p>
                  </div>
                </div>
                {role.is_system ? <Badge variant="outline">System</Badge> : null}
              </CardHeader>
              <CardContent>
                <p className="min-h-10 text-sm leading-6 text-muted-foreground">
                  {role.description || "No role description."}
                </p>
                <div className="mt-5 flex items-center gap-2 border-t border-border pt-4 text-sm font-medium">
                  <KeyRound className="size-4 text-primary" aria-hidden="true" />
                  {rolePermissionDetails.length} permission
                  {rolePermissionDetails.length === 1 ? "" : "s"}
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {rolePermissionDetails.slice(0, 6).map((permission) => (
                    <Badge key={permission.code} variant="secondary">
                      {permission.name}
                    </Badge>
                  ))}
                  {rolePermissionDetails.length > 6 ? (
                    <Badge variant="outline">
                      +{rolePermissionDetails.length - 6} more
                    </Badge>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
