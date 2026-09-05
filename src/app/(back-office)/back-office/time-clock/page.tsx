import { Clock3, UserRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackOfficeStateCard } from "@/components/back-office/back-office-state-card";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadTimeAttendanceWorkspace } from "@/features/time-clock/data";
import { resolveBackOfficeStoreScope } from "@/lib/server/back-office-store-scope";
import { requireBackOfficePermission } from "@/lib/auth/dal";

export const metadata = { title: "Time & attendance" };

function formatDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function formatDuration(start: string, end: string | null) {
  const elapsedMilliseconds = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  const elapsedMinutes = Math.max(0, Math.floor(elapsedMilliseconds / 60_000));
  return `${Math.floor(elapsedMinutes / 60)}h ${String(elapsedMinutes % 60).padStart(2, "0")}m`;
}

export default async function TimeClockPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string; employee?: string; start?: string; end?: string }>;
}) {
  const context = await requireBackOfficePermission("employees.manage");
  const parameters = await searchParams;
  const storeScope = resolveBackOfficeStoreScope(context, parameters);
  if (storeScope.invalidSelection) notFound();

  if (!context.features.time_clock) {
    return (
      <div className="space-y-8">
        <PageHeader
          action={<Badge variant="outline">Feature disabled</Badge>}
          description="Attendance records are retained, but this workflow is currently disabled for the business."
          eyebrow="Team"
          title="Time & attendance"
        />
        <BackOfficeStateCard
          description="An owner or administrator can enable Time clock in Business profile & features."
          icon={<Clock3 className="size-5" aria-hidden="true" />}
          title="Time clock is disabled"
        />
      </div>
    );
  }

  const workspace = await loadTimeAttendanceWorkspace(context, {
    storeId: storeScope.selectedStoreId,
    employeeId: parameters.employee,
    start: parameters.start,
    end: parameters.end,
  });
  const employeeFilter = workspace.employees.some((employee) => employee.id === parameters.employee)
    ? parameters.employee
    : "";

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Team"
        title="Time & attendance"
        description="Review employee timecards and attendance status. Attendance remains separate from register shifts and cash accountability."
        action={<Badge variant={workspace.clockedInCount > 0 ? "secondary" : "outline"}><Clock3 aria-hidden="true" />{workspace.clockedInCount} clocked in</Badge>}
      />

      <Card>
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary"><Clock3 className="size-5" aria-hidden="true" /></span>
            <div>
              <CardTitle>Attendance records</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Filter by date, store, or employee. The most recent 200 matching entries are shown.</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <GlobalFilterBar
            action="/back-office/time-clock"
            embedded
            fromDate={parameters.start}
            namePrefix="time-attendance-filter"
            primaryAdditionalFields={(
              <label className="grid min-w-0 gap-1.5 text-sm font-medium lg:min-w-48 lg:flex-none">
                Employee
                <select className="h-8 min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue={employeeFilter} name="employee">
                  <option value="">All employees</option>
                  {workspace.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.employeeNumber}</option>)}
                </select>
              </label>
            )}
            showEmbeddedDividers={false}
            storeId={storeScope.selectedStoreId}
            stores={workspace.stores}
            toDate={parameters.end}
          />

          {workspace.entries.length > 0 ? (
            <>
              <div className="grid gap-3 md:hidden">
                {workspace.entries.map((entry) => (
                  <article className="rounded-xl border p-4" key={entry.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><h2 className="truncate font-semibold">{entry.employeeName}</h2><p className="mt-1 font-mono text-xs text-muted-foreground">{entry.employeeNumber}</p></div>
                      <Badge variant={entry.clockedOutAt ? "outline" : "secondary"}>{entry.clockedOutAt ? "Completed" : "Clocked in"}</Badge>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                      <div><dt className="text-muted-foreground">Store</dt><dd className="mt-1 font-medium">{entry.storeName}</dd></div>
                      <div><dt className="text-muted-foreground">Duration</dt><dd className="mt-1 font-medium">{formatDuration(entry.clockedInAt, entry.clockedOutAt)}</dd></div>
                      <div><dt className="text-muted-foreground">Clocked in</dt><dd className="mt-1">{formatDateTime(entry.clockedInAt, context.organization.timezone)}</dd></div>
                      <div><dt className="text-muted-foreground">Clocked out</dt><dd className="mt-1">{entry.clockedOutAt ? formatDateTime(entry.clockedOutAt, context.organization.timezone) : "Still clocked in"}</dd></div>
                    </dl>
                    <div className="mt-4 flex justify-end"><Link className={buttonVariants({ size: "sm", variant: "ghost" })} href={`/back-office/employees/${entry.employeeId}`}><UserRound aria-hidden="true" />View employee</Link></div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto rounded-xl border md:block">
                <table className="w-full min-w-180 text-left text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr><th className="px-4 py-3 font-medium">Employee</th><th className="px-4 py-3 font-medium">Store</th><th className="px-4 py-3 font-medium">Clocked in</th><th className="px-4 py-3 font-medium">Clocked out</th><th className="px-4 py-3 font-medium">Duration</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3"><span className="sr-only">Employee actions</span></th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {workspace.entries.map((entry) => <tr key={entry.id}><td className="px-4 py-3"><p className="font-medium">{entry.employeeName}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{entry.employeeNumber}</p></td><td className="px-4 py-3">{entry.storeName}</td><td className="px-4 py-3 whitespace-nowrap">{formatDateTime(entry.clockedInAt, context.organization.timezone)}</td><td className="px-4 py-3 whitespace-nowrap">{entry.clockedOutAt ? formatDateTime(entry.clockedOutAt, context.organization.timezone) : "—"}</td><td className="px-4 py-3 whitespace-nowrap">{formatDuration(entry.clockedInAt, entry.clockedOutAt)}</td><td className="px-4 py-3"><Badge variant={entry.clockedOutAt ? "outline" : "secondary"}>{entry.clockedOutAt ? "Completed" : "Clocked in"}</Badge></td><td className="px-4 py-3 text-right"><Link aria-label={`View ${entry.employeeName}`} className={buttonVariants({ size: "sm", variant: "ghost" })} href={`/back-office/employees/${entry.employeeId}`}><UserRound aria-hidden="true" />View</Link></td></tr>)}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <BackOfficeStateCard description="Try broadening the selected date range, store, or employee filter." icon={<Clock3 className="size-5" aria-hidden="true" />} title="No attendance records found" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
