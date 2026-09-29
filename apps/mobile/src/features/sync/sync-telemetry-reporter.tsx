import { useCallback, useEffect } from "react";
import { AppState } from "react-native";

import { getDeviceSyncState } from "../../db/device-sync-state";
import { getLocalDatabaseHealth } from "../../db/health";
import { getOutboxSummary } from "../../db/outbox";
import { getSyncCursor } from "../../db/sync-cursor";
import { reportPosV2SyncTelemetry } from "../../lib/tindio-api";
import { useBusinessContext } from "../business/use-business-context";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { readConnectionModeState } from "../offline/connection-mode-state";
import { readProductionCrashState } from "../observability/production-crash-state";
import { getPerformanceMetrics } from "../performance/performance-metrics";

function metric(value: number) { return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0; }

export function SyncTelemetryReporter() {
  const { data, connectionMode } = useBusinessContext();
  const core = data?.core;
  const report = useCallback(async () => {
    if (!core) return;
    const identity = await loadMobileDeviceIdentity(core.organization.id);
    if (!identity?.binding) return;
    const performance = getPerformanceMetrics();
    const [outbox, sequence, cursor, modeState, localDatabase, crashState] = await Promise.all([
      getOutboxSummary(core.organization.id),
      getDeviceSyncState(core.organization.id, identity.credential.deviceId),
      getSyncCursor(core.organization.id, identity.credential.deviceId, identity.binding.storeId),
      readConnectionModeState(core.organization.id),
      getLocalDatabaseHealth(),
      readProductionCrashState(),
    ]);
    const localDatabaseHealth = localDatabase.error ? "UNAVAILABLE" as const : localDatabase.ready ? "HEALTHY" as const : "CHECK_REQUIRED" as const;
    try {
      await reportPosV2SyncTelemetry(core.organization.id, {
        device: identity.credential, employeeId: core.employee.id, employeeName: core.employee.name, connectionMode,
        lastSuccessfulSyncAt: cursor?.lastReconcileAt ?? null,
        deviceCheckpoint: Math.max(0, (sequence?.nextSequence ?? 1) - 1), serverCheckpoint: sequence?.serverCheckpoint ?? 0,
        queueDepth: outbox.pending + outbox.syncing + outbox.conflict + outbox.failed, conflictCount: outbox.conflict, failedCount: outbox.failed,
        offlineSince: modeState?.offlineSince ?? (connectionMode === "CLOUD_ONLINE" ? null : modeState?.changedAt ?? null),
        crashCount: crashState.count, crashWindowStartedAt: crashState.windowStartedAt, lastCrashAt: crashState.lastCrashAt,
        apiAverageLatencyMs: metric(performance.apiAverageLatencyMs), apiMaxLatencyMs: metric(performance.apiMaxLatencyMs), apiFailureCount: metric(performance.apiFailures),
        syncAverageLatencyMs: metric(performance.syncAverageDurationMs), syncMaxLatencyMs: metric(performance.syncMaxDurationMs),
        localDatabaseHealth, localSchemaVersion: localDatabase.schemaVersion,
      });
    } catch { /* Observability never affects transaction or synchronization behavior. */ }
  }, [connectionMode, core]);
  useEffect(() => {
    void report();
    const interval = setInterval(() => void report(), 60_000);
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") void report(); });
    return () => { clearInterval(interval); appState.remove(); };
  }, [report]);
  return null;
}
