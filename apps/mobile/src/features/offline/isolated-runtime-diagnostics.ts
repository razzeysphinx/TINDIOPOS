import {
  getOutboxSummary,
  getOldestUnresolvedOutboxEvent,
} from "../../db/outbox";
import {
  getSyncCursor,
} from "../../db/sync-cursor";
import {
  getDeviceSyncState,
} from "../../db/device-sync-state";
import {
  getStoreHubState,
} from "../../db/store-hub-cache";
import {
  readConnectionModeState,
} from "./connection-mode-state";
import {
  validateOfflineAuthorizationGrant,
} from "./offline-authorization";

export async function getIsolatedRuntimeDiagnostics(input: {
  organizationId: string;
  storeId: string;
  deviceId: string;
}) {
  const [
    outbox,
    oldest,
    sequence,
    cursor,
    hub,
    connection,
    authorization,
  ] = await Promise.all([
    getOutboxSummary(input.organizationId),
    getOldestUnresolvedOutboxEvent(
      input.organizationId,
    ),
    getDeviceSyncState(
      input.organizationId,
      input.deviceId,
    ),
    getSyncCursor(
      input.organizationId,
      input.deviceId,
      input.storeId,
    ),
    getStoreHubState({
      organizationId:
        input.organizationId,
      storeId:
        input.storeId,
      deviceId:
        input.deviceId,
    }),
    readConnectionModeState(
      input.organizationId,
    ),
    validateOfflineAuthorizationGrant(),
  ]);

  const unresolved =
    outbox.pending
    + outbox.syncing
    + outbox.conflict
    + outbox.failed;

  return {
    connectionMode:
      connection?.mode ?? "UNKNOWN",
    connectionChangedAt:
      connection?.changedAt ?? null,
    unresolvedTransactions: unresolved,
    pendingTransactions:
      outbox.pending,
    syncingTransactions:
      outbox.syncing,
    conflictTransactions:
      outbox.conflict,
    failedTransactions:
      outbox.failed,
    oldestUnresolvedReference:
      oldest?.localReference ?? null,
    oldestUnresolvedState:
      oldest?.state ?? null,
    nextDeviceSequence:
      sequence?.nextSequence ?? null,
    serverCheckpoint:
      sequence?.serverCheckpoint ?? null,
    pullCursor:
      cursor?.pullCursor ?? null,
    lastReconcileAt:
      cursor?.lastReconcileAt ?? null,
    storeHubLastContactAt:
      hub?.lastContactAt ?? null,
    storeHubLastError:
      hub?.lastError ?? null,
    offlineAuthorization:
      authorization.ok
        ? "VALID"
        : authorization.reason,
    recoverySafeForCloudOnline:
      unresolved === 0
      && !cursor?.lastError,
  };
}
