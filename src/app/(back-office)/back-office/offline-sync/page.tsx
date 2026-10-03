import {
  notFound,
  redirect,
} from "next/navigation";

import {
  GlobalFilterBar,
} from "@/components/back-office/global-filter-bar";
import {
  PageHeader,
} from "@/components/back-office/page-header";
import {
  OfflineSyncCenter,
  type OfflineSyncEventItem,
} from "@/features/offline/offline-sync-center";
import {
  SyncControlCenterDeviceHealth,
  type SyncControlDeviceItem,
} from "@/features/offline/sync-control-center-device-health";
import {
  hasPermission,
  requireBackOfficePermission,
} from "@/lib/auth/dal";
import {
  loadAuthorizedBackOfficeStores,
  resolveBackOfficeStoreScope,
} from "@/lib/server/back-office-store-scope";
import {
  createClient,
} from "@/lib/supabase/server";

export const metadata = {
  title: "Sync Control Center",
};

type DeviceRow = {
  id: string;
  name: string;
  store_id: string;
  register_id: string;
};

type StoreRow = {
  id: string;
  name: string;
};

type RegisterRow = {
  id: string;
  name: string;
};

type TelemetryRow = {
  organization_id: string;
  device_id: string;
  store_id: string;
  register_id: string;
  employee_id: string;
  employee_name_snapshot: string;
  connection_mode:
    SyncControlDeviceItem["connectionMode"];
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

export default async function OfflineSyncPage({
  searchParams,
}: {
  searchParams: Promise<{
    store?: string;
  }>;
}) {
  const context =
    await requireBackOfficePermission(
      "devices.manage",
    );

  if (
    !hasPermission(
      context,
      "devices.manage",
    )
  ) {
    redirect("/back-office");
  }

  const parameters =
    await searchParams;

  const scope =
    resolveBackOfficeStoreScope(
      context,
      parameters,
    );

  if (scope.invalidSelection) {
    notFound();
  }

  const supabase =
    await createClient();

  const telemetryDatabase =
    supabase as unknown as {
      from: (
        table:
          | "pos_device_sync_telemetry"
          | "pos_devices"
          | "stores"
          | "registers",
      ) => {
        select: (
          columns: string,
        ) => {
          eq: (
            column: string,
            value: string,
          ) => {
            order: (
              column: string,
              options: {
                ascending: boolean;
              },
            ) => Promise<{
              data: unknown[] | null;
              error: {
                message: string;
              } | null;
            }>;
          };
          order: (
            column: string,
            options: {
              ascending: boolean;
            },
          ) => Promise<{
            data: unknown[] | null;
            error: {
              message: string;
            } | null;
          }>;
        };
      };
    };

  const [
    eventsResult,
    telemetryResult,
    devicesResult,
    storesResult,
    registersResult,
    stores,
  ] = await Promise.all([
    supabase
      .from("offline_sync_events")
      .select(
        "id, store_id, local_receipt_reference, state, conflict_type, failure_message, store_name_snapshot, register_name_snapshot, device_name_snapshot, employee_name_snapshot, local_created_at, last_attempt_at, attempt_count, official_receipt_number",
      )
      .eq(
        "organization_id",
        context.organization.id,
      )
      .order(
        "last_attempt_at",
        { ascending: false },
      )
      .limit(200),

    telemetryDatabase
      .from(
        "pos_device_sync_telemetry",
      )
      .select(
        "organization_id,device_id,store_id,register_id,employee_id,employee_name_snapshot,connection_mode,app_version,last_heartbeat_at,last_successful_sync_at,device_checkpoint,server_checkpoint,queue_depth,conflict_count,failed_count,offline_since",
      )
      .eq(
        "organization_id",
        context.organization.id,
      )
      .order(
        "last_heartbeat_at",
        { ascending: false },
      ),

    telemetryDatabase
      .from("pos_devices")
      .select(
        "id,name,store_id,register_id",
      )
      .eq(
        "organization_id",
        context.organization.id,
      )
      .order(
        "created_at",
        { ascending: false },
      ),

    telemetryDatabase
      .from("stores")
      .select("id,name")
      .eq(
        "organization_id",
        context.organization.id,
      )
      .order(
        "name",
        { ascending: true },
      ),

    telemetryDatabase
      .from("registers")
      .select("id,name")
      .eq(
        "organization_id",
        context.organization.id,
      )
      .order(
        "name",
        { ascending: true },
      ),

    loadAuthorizedBackOfficeStores(
      context,
    ),
  ]);

  const queryError = [
    telemetryResult,
    devicesResult,
    storesResult,
    registersResult,
  ].find(
    (result) => result.error,
  )?.error;

  if (eventsResult.error) {
    throw new Error(
      `Unable to load offline sync activity: ${eventsResult.error.message}`,
    );
  }

  if (queryError) {
    throw new Error(
      `Unable to load sync telemetry: ${queryError.message}`,
    );
  }

  const selectedStoreId =
    scope.selectedStoreId;

  const devices = (devicesResult.data ?? []) as DeviceRow[];

  const storeRows = (storesResult.data ?? []) as StoreRow[];

  const registerRows = (registersResult.data ?? []) as RegisterRow[];

  const deviceById =
    new Map(
      devices.map(
        (device) => [
          device.id,
          device,
        ],
      ),
    );

  const storeNameById =
    new Map(
      storeRows.map(
        (store) => [
          store.id,
          store.name,
        ],
      ),
    );

  const registerNameById =
    new Map(
      registerRows.map(
        (register) => [
          register.id,
          register.name,
        ],
      ),
    );

  const telemetryRows = (telemetryResult.data ?? []) as TelemetryRow[];

  const telemetry: SyncControlDeviceItem[] =
      telemetryRows
        .filter(
          (row) =>
            !selectedStoreId
            || row.store_id
              === selectedStoreId,
        )
        .map((row) => ({
          deviceId:
            row.device_id,
          deviceName:
            deviceById.get(
              row.device_id,
            )?.name
            ?? "POS device",
          storeId:
            row.store_id,
          storeName:
            storeNameById.get(
              row.store_id,
            )
            ?? row.store_id,
          registerId:
            row.register_id,
          registerName:
            registerNameById.get(
              row.register_id,
            )
            ?? row.register_id,
          employeeId:
            row.employee_id,
          employeeName:
            row.employee_name_snapshot,
          connectionMode:
            row.connection_mode,
          appVersion:
            row.app_version,
          lastHeartbeatAt:
            row.last_heartbeat_at,
          lastSuccessfulSyncAt:
            row.last_successful_sync_at,
          deviceCheckpoint:
            Number(
              row.device_checkpoint,
            ),
          serverCheckpoint:
            Number(
              row.server_checkpoint,
            ),
          queueDepth:
            row.queue_depth,
          conflictCount:
            row.conflict_count,
          failedCount:
            row.failed_count,
          offlineSince:
            row.offline_since,
        }));

  const events:
    OfflineSyncEventItem[] =
      (eventsResult.data ?? [])
        .filter(
          (event) =>
            !selectedStoreId
            || event.store_id
              === selectedStoreId,
        )
        .map((event) => ({
          id: event.id,
          localReceiptReference:
            event.local_receipt_reference,
          state: event.state as OfflineSyncEventItem["state"],
          conflictType:
            event.conflict_type,
          failureMessage:
            event.failure_message,
          storeName:
            event.store_name_snapshot,
          registerName:
            event.register_name_snapshot,
          deviceName:
            event.device_name_snapshot,
          employeeName:
            event.employee_name_snapshot,
          localCreatedAt:
            event.local_created_at,
          lastAttemptAt:
            event.last_attempt_at,
          attemptCount:
            event.attempt_count,
          officialReceiptNumber:
            event.official_receipt_number,
        }));

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="POS resilience"
        title="Sync Control Center 2.0"
        description="Monitor terminal connectivity, sync checkpoints, queues, conflicts, and offline duration without exposing transaction payloads."
      />

      <GlobalFilterBar
        action="/back-office/offline-sync"
        namePrefix="offline-sync-filter"
        showDateRange={false}
        storeId={selectedStoreId}
        stores={stores}
      />

      <SyncControlCenterDeviceHealth
        devices={telemetry}
      />

      <div className="border-t pt-8">
        <PageHeader
          eyebrow="Durable transaction outcomes"
          title="Offline Event Review"
          description="Review server-observed offline sale outcomes and conflicts."
        />

        <div className="mt-6">
          <OfflineSyncCenter
            events={events}
          />
        </div>
      </div>
    </div>
  );
}
