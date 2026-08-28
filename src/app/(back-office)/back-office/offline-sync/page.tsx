import { CloudUpload } from "lucide-react";
import { notFound, redirect } from "next/navigation";

import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { Badge } from "@/components/ui/badge";
import {
  OfflineSyncCenter,
  type OfflineSyncEventItem,
} from "@/features/offline/offline-sync-center";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Offline sync" };

export default async function OfflineSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const context = await requireBackOfficePermission("devices.manage");
  if (!hasPermission(context, "devices.manage")) redirect("/back-office");
  const parameters = await searchParams;
  const scope = resolveBackOfficeStoreScope(context, parameters);
  if (scope.invalidSelection) notFound();

  const supabase = await createClient();
  const [eventsResult, stores] = await Promise.all([
    supabase
    .from("offline_sync_events")
    .select("id, store_id, local_receipt_reference, state, conflict_type, failure_message, store_name_snapshot, register_name_snapshot, device_name_snapshot, employee_name_snapshot, local_created_at, last_attempt_at, attempt_count, official_receipt_number")
    .eq("organization_id", context.organization.id)
    .order("last_attempt_at", { ascending: false })
    .limit(200),
    loadAuthorizedBackOfficeStores(context),
  ]);

  if (eventsResult.error) throw new Error(`Unable to load offline sync activity: ${eventsResult.error.message}`);

  const events: OfflineSyncEventItem[] = (eventsResult.data ?? [])
    .filter((event) => !scope.selectedStoreId || event.store_id === scope.selectedStoreId)
    .map((event) => ({
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
      <GlobalFilterBar action="/back-office/offline-sync" namePrefix="offline-sync-filter" showDateRange={false} storeId={scope.selectedStoreId} stores={stores} />
      <OfflineSyncCenter events={events} />
    </div>
  );
}
