import { ArrowLeft, Building2, Clock3, IdCard, KeyRound, ReceiptText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmployeePinForm } from "@/features/approvals/employee-pin-form";
import { EmployeeLifecycleControls, EmployeeProfileEditor } from "@/features/management/employee-lifecycle-controls";
import { EditEmployeeButton } from "@/features/management/management-forms";
import { loadManagementEmployeeDetail, loadManagementEmployees } from "@/features/management/data";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Employee details" };

const idSchema = z.uuid();

function dateTime(value: string | null, timezone: string) {
  return value ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)) : "None recorded";
}

export default async function EmployeeDetailPage({ params }: { params: Promise<{ employeeId: string }> }) {
  const context = await requireBackOfficePermission("employees.manage");
  const { employeeId } = await params;
  if (!idSchema.safeParse(employeeId).success) notFound();
  const [employee, workspace] = await Promise.all([
    loadManagementEmployeeDetail(context, employeeId),
    loadManagementEmployees(context),
  ]);
  if (!employee) notFound();
  const grantableRoles = workspace.roles.filter((role) => workspace.rolePermissions.filter((permission) => permission.role_id === role.id).every((permission) => context.permissions.includes(permission.permission_code)));
  const activeStores = workspace.stores.filter((store) => store.is_active);
  const isSelf = employee.id === context.employee.id;

  return (
    <div className="space-y-8">
      <Button nativeButton={false} render={<Link href="/back-office/employees" />} size="sm" variant="ghost"><ArrowLeft />Employees</Button>
      <PageHeader eyebrow="Team" title={employee.fullName} description={`${employee.employeeNumber} · ${employee.jobTitle || "No job title"}`} action={<Badge variant={employee.status === "active" ? "secondary" : "outline"}>{employee.status}</Badge>} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle>Overview</CardTitle></CardHeader><CardContent className="space-y-5">
          <EmployeeProfileEditor employee={employee} />
          <dl className="grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Roles</dt><dd className="mt-1 flex flex-wrap gap-1">{employee.roles.map((role) => <Badge key={role.id} variant="outline">{role.name}</Badge>)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Stores</dt><dd className="mt-1">{employee.stores.map((store) => store.name).join(", ") || "No store assignment"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">POS access</dt><dd className="mt-1">{employee.posAccess ? "Allowed" : "Not allowed"}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Back Office</dt><dd className="mt-1">{employee.backOfficeAccess ? "Allowed" : "Not allowed"}</dd></div>
          </dl>
          {employee.status !== "archived" && (!isSelf || hasPermission(context, "organization.manage")) ? <EditEmployeeButton employee={{ id: employee.id, jobTitle: employee.jobTitle, status: employee.status, roleIds: employee.roles.map((role) => role.id), storeIds: employee.stores.map((store) => store.id) }} roles={grantableRoles} stores={activeStores} lockOwnRoleAndStatus={isSelf} organizationWideStoreAccess={isSelf && hasPermission(context, "organization.manage")} /> : null}
        </CardContent></Card>

        <Card><CardHeader><CardTitle>Access security</CardTitle></CardHeader><CardContent className="space-y-4">
          <p className="flex items-center gap-2"><KeyRound className="size-4" />PIN {employee.pinIsSet ? "set" : "not set"}</p>
          {employee.status === "active" ? <EmployeePinForm employeeId={employee.id} employeeName={employee.fullName} /> : <p className="text-sm text-muted-foreground">PIN access is disabled until this employee is active and a new PIN is set.</p>}
        </CardContent></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>Attendance</CardTitle></CardHeader><CardContent className="space-y-4">
          <p className="flex items-center gap-2"><Clock3 className="size-4" />{employee.attendance.current ? `Clocked in at ${employee.attendance.current.storeName ?? "assigned store"}` : "Not clocked in"}</p>
          <p className="text-sm text-muted-foreground">Last clock-in: {dateTime(employee.attendance.lastClockIn, context.organization.timezone)}</p>
          <div className="divide-y rounded-xl border">
            {employee.attendance.history.length ? employee.attendance.history.map((entry) => <div className="grid gap-1 p-3 text-sm sm:grid-cols-3" key={entry.id}><span>{entry.storeName}</span><span>{dateTime(entry.clockedInAt, context.organization.timezone)}</span><span>{entry.clockedOutAt ? dateTime(entry.clockedOutAt, context.organization.timezone) : "Open"}</span></div>) : <p className="p-3 text-sm text-muted-foreground">No attendance history.</p>}
          </div>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Activity</CardTitle></CardHeader><CardContent><dl className="grid grid-cols-2 gap-4">
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><ReceiptText className="size-4" />Receipts</dt><dd className="mt-1 text-2xl font-semibold">{employee.activity.receipts}</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><IdCard className="size-4" />Register shifts</dt><dd className="mt-1 text-2xl font-semibold">{employee.activity.registerShifts}</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4" />Refunds</dt><dd className="mt-1 text-2xl font-semibold">{employee.activity.refunds}</dd></div>
          <div><dt className="flex items-center gap-2 text-xs text-muted-foreground"><Building2 className="size-4" />Inventory movements</dt><dd className="mt-1 text-2xl font-semibold">{employee.activity.inventoryMovements}</dd></div>
        </dl></CardContent></Card>
      </div>

      {!isSelf ? <Card><CardHeader><CardTitle>Employee lifecycle</CardTitle></CardHeader><CardContent><EmployeeLifecycleControls employee={employee} /></CardContent></Card> : null}
    </div>
  );
}
