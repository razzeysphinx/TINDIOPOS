import {
  useCallback,
  useEffect,
} from "react";
import {
  AppState,
} from "react-native";

import {
  getDeviceSyncState,
} from "../../db/device-sync-state";
import {
  getOutboxSummary,
} from "../../db/outbox";
import {
  getSyncCursor,
} from "../../db/sync-cursor";
import {
  reportPosV2SyncTelemetry,
} from "../../lib/tindio-api";
import {
  useBusinessContext,
} from "../business/use-business-context";
import {
  loadMobileDeviceIdentity,
} from "../device/device-store";
import {
  readConnectionModeState,
} from "../offline/connection-mode-state";

export function SyncTelemetryReporter() {
  const {
    data,
    connectionMode,
  } = useBusinessContext();

  const core = data?.core;

  const report = useCallback(
    async () => {
      if (!core) return;

      const identity =
        await loadMobileDeviceIdentity(
          core.organization.id,
        );

      if (!identity?.binding) return;

      const [
        outbox,
        sequence,
        cursor,
        modeState,
      ] = await Promise.all([
        getOutboxSummary(
          core.organization.id,
        ),
        getDeviceSyncState(
          core.organization.id,
          identity.credential.deviceId,
        ),
        getSyncCursor(
          core.organization.id,
          identity.credential.deviceId,
          identity.binding.storeId,
        ),
        readConnectionModeState(
          core.organization.id,
        ),
      ]);

      const queueDepth =
        outbox.pending
        + outbox.syncing
        + outbox.conflict
        + outbox.failed;

      try {
        await reportPosV2SyncTelemetry(
          core.organization.id,
          {
            device:
              identity.credential,
            employeeId:
              core.employee.id,
            employeeName:
              core.employee.name,
            connectionMode,
            lastSuccessfulSyncAt:
              cursor?.lastReconcileAt
              ?? null,
            deviceCheckpoint:
              Math.max(
                0,
                (sequence?.nextSequence ?? 1)
                  - 1,
              ),
            serverCheckpoint:
              sequence?.serverCheckpoint
              ?? 0,
            queueDepth,
            conflictCount:
              outbox.conflict,
            failedCount:
              outbox.failed,
            offlineSince:
              modeState?.offlineSince
              ?? (
                connectionMode
                  === "CLOUD_ONLINE"
                  ? null
                  : modeState?.changedAt
                    ?? null
              ),
          },
        );
      } catch {
        // Telemetry is observational only.
        // Transaction/sync behavior must never fail because heartbeat reporting failed.
      }
    },
    [
      connectionMode,
      core,
    ],
  );

  useEffect(() => {
    void report();

    const interval =
      setInterval(
        () => void report(),
        60_000,
      );

    const appState =
      AppState.addEventListener(
        "change",
        (state) => {
          if (state === "active") {
            void report();
          }
        },
      );

    return () => {
      clearInterval(interval);
      appState.remove();
    };
  }, [report]);

  return null;
}
