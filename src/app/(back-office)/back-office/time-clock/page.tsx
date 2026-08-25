import { Clock3 } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadTimeClockWorkspace } from "@/features/time-clock/data";
import { TimeClockControl } from "@/features/time-clock/time-clock-control";
import { requireBusinessContext } from "@/lib/auth/dal";

export const metadata = { title: "Time clock" };

export default async function TimeClockPage() {
  const context = await requireBusinessContext();

  if (!context.features.time_clock) {
    return (
      <div className="space-y-8">
        <PageHeader
          action={<Badge variant="outline">Feature disabled</Badge>}
          description="Time clock records are retained, but this workflow is currently disabled for the business."
          eyebrow="Attendance"
          title="Time clock"
        />
        <Card>
          <CardHeader>
            <CardTitle>Time clock is disabled</CardTitle>
            <CardDescription>An owner or administrator can enable it in Business profile &amp; features.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const workspace = await loadTimeClockWorkspace(context);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Attendance"
        title="Time clock"
        description="Track your work time separately from register shifts and cash accountability."
        action={<Badge variant={workspace.entry ? "secondary" : "outline"}><Clock3 aria-hidden="true" />{workspace.entry ? "Clocked in" : "Clocked out"}</Badge>}
      />
      <TimeClockControl
        initialEntry={workspace.entry}
        stores={workspace.stores}
        timezone={context.organization.timezone}
      />
    </div>
  );
}
