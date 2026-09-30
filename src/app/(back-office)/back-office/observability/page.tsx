import { notFound, redirect } from "next/navigation";
import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { ProductionObservabilityCenter, type ProductionObservabilityDevice } from "@/features/observability/production-observability-center";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { loadAuthorizedBackOfficeStores, resolveBackOfficeStoreScope } from "@/lib/server/back-office-store-scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Production Observability" };
type Query = { select: (columns: string) => { eq: (column: string, value: string) => { order: (column: string, options: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }> } } };

async function measureDatabaseProbe<T>(request: () => Promise<T>) {
  const startedAt = Date.now();
  const result = await request();

  return {
    result,
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
}

export default async function ObservabilityPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const context = await requireBackOfficePermission("devices.manage");
  if (!hasPermission(context, "devices.manage")) redirect("/back-office");
  const scope = resolveBackOfficeStoreScope(context, await searchParams);
  if (scope.invalidSelection) notFound();
  const supabase = await createClient();
  const { result: probe, latencyMs: serverDatabaseProbeLatencyMs } = await measureDatabaseProbe(
    () => supabase.from("organizations").select("id").eq("id", context.organization.id).maybeSingle(),
  );
  const database = supabase as unknown as { from: (table: string) => Query };
  const [telemetryResult, devicesResult, storesResult, registersResult, filterStores] = await Promise.all([
    database.from("pos_device_sync_telemetry").select("device_id,store_id,register_id,employee_name_snapshot,connection_mode,app_version,last_heartbeat_at,last_successful_sync_at,device_checkpoint,server_checkpoint,queue_depth,conflict_count,failed_count,offline_since,crash_count,crash_window_started_at,last_crash_at,api_average_latency_ms,api_max_latency_ms,api_failure_count,sync_average_latency_ms,sync_max_latency_ms,local_database_health,local_schema_version").eq("organization_id", context.organization.id).order("last_heartbeat_at", { ascending: false }),
    database.from("pos_devices").select("id,name,status").eq("organization_id", context.organization.id).order("created_at", { ascending: false }),
    database.from("stores").select("id,name").eq("organization_id", context.organization.id).order("name", { ascending: true }),
    database.from("registers").select("id,name").eq("organization_id", context.organization.id).order("name", { ascending: true }),
    loadAuthorizedBackOfficeStores(context),
  ]);
  const queryError = [telemetryResult, devicesResult, storesResult, registersResult].find((result) => result.error)?.error;
  if (queryError) throw new Error(`Unable to load production observability: ${queryError.message}`);
  const devices = new Map(((devicesResult.data ?? []) as Array<{ id: string; name: string; status: "active" | "revoked" }>).map((row) => [row.id, row]));
  const stores = new Map(((storesResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const registers = new Map(((registersResult.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name]));
  const observability = ((telemetryResult.data ?? []) as Array<Record<string, unknown>>).filter((row) => !scope.selectedStoreId || row.store_id === scope.selectedStoreId).map((row): ProductionObservabilityDevice => {
    const device = devices.get(row.device_id as string);
    return { deviceId: row.device_id as string, deviceName: device?.name ?? "POS device", deviceStatus: device?.status ?? "active", storeName: stores.get(row.store_id as string) ?? String(row.store_id), registerName: registers.get(row.register_id as string) ?? String(row.register_id), employeeName: row.employee_name_snapshot as string, connectionMode: row.connection_mode as ProductionObservabilityDevice["connectionMode"], appVersion: row.app_version as string, lastHeartbeatAt: row.last_heartbeat_at as string, lastSuccessfulSyncAt: row.last_successful_sync_at as string | null, offlineSince: row.offline_since as string | null, deviceCheckpoint: Number(row.device_checkpoint), serverCheckpoint: Number(row.server_checkpoint), queueDepth: Number(row.queue_depth), conflictCount: Number(row.conflict_count), failedCount: Number(row.failed_count), crashCount: Number(row.crash_count), crashWindowStartedAt: row.crash_window_started_at as string | null, lastCrashAt: row.last_crash_at as string | null, apiAverageLatencyMs: Number(row.api_average_latency_ms), apiMaxLatencyMs: Number(row.api_max_latency_ms), apiFailureCount: Number(row.api_failure_count), syncAverageLatencyMs: Number(row.sync_average_latency_ms), syncMaxLatencyMs: Number(row.sync_max_latency_ms), localDatabaseHealth: row.local_database_health as ProductionObservabilityDevice["localDatabaseHealth"], localSchemaVersion: Number(row.local_schema_version) };
  });
  return <div className="space-y-8"><PageHeader eyebrow="Production health" title="Production Observability" description="Detect terminal crashes, latency, offline queues, sync failures, checkpoint gaps, heartbeat loss, and database-health problems before they become silent business failures." /><GlobalFilterBar action="/back-office/observability" namePrefix="observability-filter" showDateRange={false} storeId={scope.selectedStoreId} stores={filterStores} /><ProductionObservabilityCenter devices={observability} serverDatabaseHealth={probe.error ? "UNAVAILABLE" : "HEALTHY"} serverDatabaseProbeLatencyMs={serverDatabaseProbeLatencyMs} /></div>;
}
