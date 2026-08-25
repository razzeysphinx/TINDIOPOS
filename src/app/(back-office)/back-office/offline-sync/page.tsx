import { CloudUpload } from "lucide-react";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import {
  OfflineSyncCenter,
  type OfflineSyncEventItem,
} from "@/features/offline/offline-sync-center";
import { hasPermission, requireBusinessContext } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Offline sync" };

export default async function OfflineSyncPage() {
  const context = await requireBusinessContext();
  if (!hasPermission(context, "devices.manage")) redirect("/back-office");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("offline_sync_events")
    .select("id, local_receipt_reference, state, conflict_type, failure_message, store_name_snapshot, register_name_snapshot, device_name_snapshot, employee_name_snapshot, local_created_at, last_attempt_at, attempt_count, official_receipt_number")
    .eq("organization_id", context.organization.id)
    .order("last_attempt_at", { ascending: false })
    .limit(200);

  if (error) throw new Error(`Unable to load offline sync activity: ${error.message}`);

  const events: OfflineSyncEventItem[] = (data ?? []).map((event) => ({
    id: event.id,
    localReceiptReference: event.local_receipt_reference,
    state: event.state as OfflineSyncEventItem["state"],
    conflictType: event.conflict_type,
    failureMessage: event.failure_message,
    storeName: event.store_name_snapshot,
    registerName: event.register_name_snapshot,
    deviceName: event.device_name_snapshot,
    employeeName: event.employee_name_snapshot,
    localCreatedAt: event.local_created_at,
    lastAttemptAt: event.last_attempt_at,
    attemptCount: event.attempt_count,
    officialReceiptNumber: event.official_receipt_number,
  }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="POS resilience"
        title="Offline sync center"
        description="Review every server-observed offline POS synchronization result by store, register, device, and cashier. Fix an issue first, then retry the original temporary receipt from its POS device."
        action={<Badge variant="secondary"><CloudUpload /> Device manager</Badge>}
      />
      <OfflineSyncCenter events={events} />
    </div>
  );
}
