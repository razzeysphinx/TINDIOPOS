import { notFound, redirect } from "next/navigation";

import { GlobalFilterBar } from "@/components/back-office/global-filter-bar";
import { PageHeader } from "@/components/back-office/page-header";
import { DeviceManager, type DeviceFleetItem } from "@/features/devices/device-manager";
import { hasPermission, requireBackOfficePermission } from "@/lib/auth/dal";
import { loadAuthorizedBackOfficeStores, resolveBackOfficeStoreScope } from "@/lib/server/back-office-store-scope";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "POS Device Fleet" };

type PosDeviceRow = {
  id: string;
  name: string;
  store_id: string;
  register_id: string;
  status: "active" | "revoked";
  app_version: string;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

type TelemetryRow = {
  device_id: string;
  employee_name_snapshot: string;
  connection_mode: "CLOUD_ONLINE" | "STORE_LOCAL" | "DEVICE_ISOLATED" | "RECOVERING" | "SYNC_REVIEW";
  app_version: string;
  last_heartbeat_at: string;
  last_successful_sync_at: string | null;
  device_checkpoint: number;
  server_checkpoint: number;
  queue_depth: number;
  conflict_count: number;
  failed_count: number;
  offline_since: string | null;
};

type FleetQuery = {
  select: (columns: string) => {
    eq: (column: string, value: string) => {
      order: (column: string, options: { ascending: boolean }) => Promise<{
        data: unknown[] | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export default async function DevicesPage({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const context = await requireBackOfficePermission("devices.manage");
  if (!hasPermission(context, "devices.manage")) redirect("/back-office");

  const scope = resolveBackOfficeStoreScope(context, await searchParams);
  if (scope.invalidSelection) notFound();

  const supabase = await createClient();
  const fleetDatabase = supabase as unknown as {
    from: (table: "pos_devices" | "pos_device_sync_telemetry") => FleetQuery;
  };
  const [storesResult, registersResult, devicesResult, telemetryResult, filterStores] = await Promise.all([
    supabase.from("stores").select("id, name").eq("organization_id", context.organization.id).eq("is_active", true).order("name", { ascending: true }),
    supabase.from("registers").select("id, store_id, name, code").eq("organization_id", context.organization.id).eq("is_active", true).order("name", { ascending: true }),
    fleetDatabase.from("pos_devices").select("id,name,store_id,register_id,status,app_version,last_seen_at,created_at,revoked_at").eq("organization_id", context.organization.id).order("created_at", { ascending: false }),
    fleetDatabase.from("pos_device_sync_telemetry").select("device_id,employee_name_snapshot,connection_mode,app_version,last_heartbeat_at,last_successful_sync_at,device_checkpoint,server_checkpoint,queue_depth,conflict_count,failed_count,offline_since").eq("organization_id", context.organization.id).order("last_heartbeat_at", { ascending: false }),
    loadAuthorizedBackOfficeStores(context),
  ]);

  const queryError = [storesResult, registersResult, devicesResult, telemetryResult].find((result) => result.error)?.error;
  if (queryError) throw new Error(`Unable to load POS device fleet: ${queryError.message}`);

  const selectedStoreId = scope.selectedStoreId;
  const stores = (storesResult.data ?? []).filter((store) => !selectedStoreId || store.id === selectedStoreId);
  const registers = (registersResult.data ?? []).filter((register) => !selectedStoreId || register.store_id === selectedStoreId);
  const telemetryRows = (telemetryResult.data ?? []) as TelemetryRow[];
  const telemetry = new Map(telemetryRows.map((row) => [row.device_id, row]));
  const devices = (devicesResult.data ?? []) as PosDeviceRow[];
  const fleet: DeviceFleetItem[] = devices
    .filter((device) => !selectedStoreId || device.store_id === selectedStoreId)
    .map((device) => {
      const state = telemetry.get(device.id);
      return {
        id: device.id,
        name: device.name,
        storeId: device.store_id,
        registerId: device.register_id,
        status: device.status,
        appVersion: state?.app_version ?? device.app_version,
        lastSeenAt: device.last_seen_at,
        createdAt: device.created_at,
        revokedAt: device.revoked_at,
        telemetry: state ? {
          employeeName: state.employee_name_snapshot,
          connectionMode: state.connection_mode,
          lastHeartbeatAt: state.last_heartbeat_at,
          lastSuccessfulSyncAt: state.last_successful_sync_at,
          deviceCheckpoint: Number(state.device_checkpoint),
          serverCheckpoint: Number(state.server_checkpoint),
          queueDepth: state.queue_depth,
          conflictCount: state.conflict_count,
          failedCount: state.failed_count,
          offlineSince: state.offline_since,
        } : null,
      };
    });

  return <div className="space-y-8">
    <PageHeader eyebrow="Device fleet" title="POS Device Fleet" description="Enroll, assign, monitor, disable, and replace POS terminals without manual database work." />
    <GlobalFilterBar action="/back-office/devices" namePrefix="device-filter" showDateRange={false} storeId={selectedStoreId} stores={filterStores} />
    <DeviceManager business={{ id: context.organization.id, name: context.organization.name }} devices={fleet} registers={registers.map((register) => ({ id: register.id, storeId: register.store_id, name: register.name, code: register.code }))} stores={stores} />
  </div>;
}
