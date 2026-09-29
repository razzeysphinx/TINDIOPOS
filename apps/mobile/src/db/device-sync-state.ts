import type { SQLiteDatabase } from "expo-sqlite";
import { getTindioDatabase } from "./database";

export type DeviceSyncState = {
  organizationId: string;
  deviceId: string;
  nextSequence: number;
  serverCheckpoint: number;
  checkpointObservedAt: string | null;
  lastServerStatus: string | null;
};

type DeviceSyncStateRow = {
  organization_id: string;
  device_id: string;
  next_sequence: number;
  server_checkpoint: number;
  checkpoint_observed_at: string | null;
  last_server_status: string | null;
};

const toState = (
  row: DeviceSyncStateRow,
): DeviceSyncState => ({
  organizationId: row.organization_id,
  deviceId: row.device_id,
  nextSequence: row.next_sequence,
  serverCheckpoint: row.server_checkpoint,
  checkpointObservedAt:
    row.checkpoint_observed_at,
  lastServerStatus:
    row.last_server_status,
});

export async function ensureDeviceSyncState(
  transaction: SQLiteDatabase,
  organizationId: string,
  deviceId: string,
) {
  await transaction.runAsync(
    "INSERT INTO device_sync_state (organization_id,device_id,next_sequence) SELECT ?,?,COALESCE(MAX(device_sequence),0)+1 FROM outbox_events WHERE organization_id=? AND device_id=? ON CONFLICT(organization_id,device_id) DO NOTHING",
    organizationId,
    deviceId,
    organizationId,
    deviceId,
  );

  return transaction.getFirstAsync<DeviceSyncStateRow>(
    "SELECT * FROM device_sync_state WHERE organization_id=? AND device_id=?",
    organizationId,
    deviceId,
  );
}

export async function getDeviceSyncState(
  organizationId: string,
  deviceId: string,
): Promise<DeviceSyncState | null> {
  const database =
    await getTindioDatabase();

  let resolved:
    DeviceSyncState | null = null;

  await database.withExclusiveTransactionAsync(
    async (transaction) => {
      const row =
        await ensureDeviceSyncState(
          transaction,
          organizationId,
          deviceId,
        );

      resolved =
        row
          ? toState(row)
          : null;
    },
  );

  return resolved;
}

export async function recordServerCheckpoint(
  input: {
    organizationId: string;
    deviceId: string;
    serverCheckpoint: number;
    status: string;
  },
): Promise<DeviceSyncState | null> {
  const database =
    await getTindioDatabase();

  let resolved:
    DeviceSyncState | null = null;

  await database.withExclusiveTransactionAsync(
    async (transaction) => {
      await ensureDeviceSyncState(
        transaction,
        input.organizationId,
        input.deviceId,
      );

      await transaction.runAsync(
        "UPDATE device_sync_state SET server_checkpoint=MAX(server_checkpoint,?),checkpoint_observed_at=?,last_server_status=? WHERE organization_id=? AND device_id=?",
        input.serverCheckpoint,
        new Date().toISOString(),
        input.status,
        input.organizationId,
        input.deviceId,
      );

      const row =
        await transaction.getFirstAsync<DeviceSyncStateRow>(
          "SELECT * FROM device_sync_state WHERE organization_id=? AND device_id=?",
          input.organizationId,
          input.deviceId,
        );

      resolved =
        row
          ? toState(row)
          : null;
    },
  );

  return resolved;
}
