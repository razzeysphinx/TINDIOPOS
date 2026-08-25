import { Clock3 } from "lucide-react";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeClockControl } from "@/features/time-clock/time-clock-control";
import { requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const [storesResult, entryResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name")
      .eq("organization_id", context.organization.id)
      .eq("is_active", true)
      .in("id", context.storeIds)
      .order("name", { ascending: true }),
    supabase.rpc("get_current_time_clock_entry", {
      target_organization_id: context.organization.id,
    }),
  ]);

  if (storesResult.error || entryResult.error) {
    throw new Error(`Unable to load the time clock: ${storesResult.error?.message ?? entryResult.error?.message}`);
  }

  const entry = entryResult.data?.[0]
    ? {
        id: entryResult.data[0].entry_id,
        storeId: entryResult.data[0].store_id,
        clockedInAt: entryResult.data[0].clocked_in_at,
      }
    : null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Attendance"
        title="Time clock"
        description="Track your work time separately from register shifts and cash accountability."
        action={<Badge variant={entry ? "secondary" : "outline"}><Clock3 aria-hidden="true" />{entry ? "Clocked in" : "Clocked out"}</Badge>}
      />
      <TimeClockControl
        initialEntry={entry}
        stores={storesResult.data ?? []}
        timezone={context.organization.timezone}
      />
    </div>
  );
}
