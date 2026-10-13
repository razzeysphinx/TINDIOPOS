import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { getOrganizationCacheStats, type OrganizationCacheStats } from "../../src/db/cache-stats";
import { hasBusinessContextSnapshot } from "../../src/db/business-context-cache";
import { getDeviceSyncState, type DeviceSyncState } from "../../src/db/device-sync-state";
import { listOutboxRecoveryItems } from "../../src/db/outbox";
import { getSyncCursor, type SyncCursorState } from "../../src/db/sync-cursor";
import { armPhase07RestartProof, getLocalDatabaseHealth, readPhase07RestartProof, type Phase07RestartProof, verifyLocalPersistence } from "../../src/db/health";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { useTerminalDevice } from "../../src/features/device/use-terminal-device";
import { getLocalFirstMetrics } from "../../src/features/local-first/runtime-metrics";
import { getPerformanceMetrics, resetPerformanceMetrics } from "../../src/features/performance/performance-metrics";
import {
  getOfflineInventoryDiagnostics,
  type OfflineInventoryDiagnostics,
} from "../../src/features/inventory/offline-inventory-diagnostics";
import { clearOfflineAuthorizationGrant, readOfflineAuthorizationGrant, validateOfflineAuthorizationGrant, type OfflineAuthorizationGrant } from "../../src/features/offline/offline-authorization";
import { prepareOfflineMode } from "../../src/features/offline/prepare-offline-mode";
import { refreshDeviceCheckpoint } from "../../src/features/outbox/checkpoint-sync";
import { getSafeOutboxDiagnostics } from "../../src/features/outbox/outbox-summary";
import { syncOutboxEvents } from "../../src/features/outbox/outbox-sync";
import { retryReviewedOutboxEvent } from "../../src/features/outbox/outbox-recovery";
import { evaluateOutboxRecovery } from "../../src/features/outbox/recovery-policy";
import type { OutboxRecoveryItem } from "../../src/features/outbox/outbox-types";
import { useSession } from "../../src/features/session/session-provider";
import { reconcileCloud } from "../../src/features/sync/reconcile-cloud";
import { getStoreHubState, type StoreHubState } from "../../src/db/store-hub-cache";
import { synchronizeWithStoreHub } from "../../src/features/store-hub/store-hub-sync";
import { getIsolatedRuntimeDiagnostics } from "../../src/features/offline/isolated-runtime-diagnostics";
import {
  createMob10A30Queue,
  isMob10A30CertificationBuild,
  type Mob10A30QueueResult,
} from "../../src/features/certification/mob-10-a30";

export default function SyncStatusScreen() {
  const { data, reload, mode, connectionMode } = useBusinessContext();
  const { accessMode, reauthenticate } = useSession();
  const organizationId = data?.core.organization.id;
  const terminal = useTerminalDevice(organizationId);
  const identity = terminal.identity;
  const binding = identity?.binding;
  const deviceId = identity?.credential.deviceId;
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getLocalDatabaseHealth>> | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [stats, setStats] = useState<OrganizationCacheStats | null>(null);
  const [restartProof, setRestartProof] = useState<Phase07RestartProof | null>(null);
  const [grant, setGrant] = useState<OfflineAuthorizationGrant | null>(null);
  const [offlineState, setOfflineState] = useState("NOT PREPARED");
  const [message, setMessage] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Awaited<ReturnType<typeof getSafeOutboxDiagnostics>> | null>(null);
  const [sequenceState, setSequenceState] = useState<DeviceSyncState | null>(null);
  const [remoteCheckpoint, setRemoteCheckpoint] = useState<number | null>(null);
  const [cursor, setCursor] = useState<SyncCursorState | null>(null);
  const [inventoryDiagnostics, setInventoryDiagnostics] =
    useState<OfflineInventoryDiagnostics | null>(null);
  const [storeHubState, setStoreHubState] =
    useState<StoreHubState | null>(null);
  const [isolatedDiagnostics, setIsolatedDiagnostics] =
    useState<Awaited<ReturnType<typeof getIsolatedRuntimeDiagnostics>> | null>(null);
  const [recoveryItems, setRecoveryItems] = useState<OutboxRecoveryItem[]>([]);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryNote, setRecoveryNote] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [a30Busy, setA30Busy] = useState(false);
  const [a30Progress, setA30Progress] = useState(0);
  const [a30Result, setA30Result] = useState<Mob10A30QueueResult | null>(null);

  const load = useCallback(async () => {
    setHealth(await getLocalDatabaseHealth()); setRestartProof(await readPhase07RestartProof());
    const savedGrant = await readOfflineAuthorizationGrant(); setGrant(savedGrant);
    const authorization = await validateOfflineAuthorizationGrant();
    setOfflineState(authorization.ok ? "READY" : authorization.reason === "EXPIRED" ? "EXPIRED" : savedGrant ? "BLOCKED" : "NOT PREPARED");
    if (organizationId) {
      setCached(await hasBusinessContextSnapshot(organizationId)); setStats(await getOrganizationCacheStats(organizationId));
      const [outboxDiagnostics, recovery] = await Promise.all([
        getSafeOutboxDiagnostics(organizationId),
        deviceId ? listOutboxRecoveryItems(organizationId, deviceId) : Promise.resolve([]),
      ]);
      setOutbox(outboxDiagnostics);
      setRecoveryItems(recovery);
      setSequenceState(deviceId ? await getDeviceSyncState(organizationId, deviceId) : null);
      setCursor(deviceId && binding ? await getSyncCursor(organizationId, deviceId, binding.storeId) : null);
      setInventoryDiagnostics(
        deviceId && binding
          ? await getOfflineInventoryDiagnostics({
              organizationId,
              storeId: binding.storeId,
              deviceId,
            })
          : null,
      );
      setStoreHubState(
        deviceId && binding
          ? await getStoreHubState({
              organizationId,
              storeId: binding.storeId,
              deviceId,
            })
          : null,
      );
      setIsolatedDiagnostics(
        deviceId && binding
          ? await getIsolatedRuntimeDiagnostics({
              organizationId,
              storeId: binding.storeId,
              deviceId,
            })
          : null,
      );
    }
  }, [binding, deviceId, organizationId]);

  useFocusEffect(useCallback(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) void load();
    }, 0);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [load]));
  const verify = useCallback(async () => { await verifyLocalPersistence(); await load(); }, [load]);
  const arm = useCallback(async () => { if (organizationId) setRestartProof(await armPhase07RestartProof(organizationId)); }, [organizationId]);
  const recheck = useCallback(async () => {
    setMessage("Rechecking backend and local custody…");
    await reload(organizationId);
    await load();
    setMessage("Backend and local custody refreshed.");
  }, [load, organizationId, reload]);
  const prepare = useCallback(async () => { if (!organizationId || mode !== "online") return; setMessage("Preparing offline mode…"); const result = await prepareOfflineMode(organizationId); setMessage(result.ok ? `OFFLINE READY UNTIL ${result.expiresAt}` : `Offline preparation blocked: ${result.reason}`); await load(); }, [organizationId, mode, load]);
  const revoke = useCallback(async () => { await clearOfflineAuthorizationGrant(); setMessage("Offline authorization revoked."); await load(); }, [load]);
  const syncOutbox = useCallback(async () => { if (!organizationId || mode !== "online") return; setMessage("Syncing durable outbox…"); const result = await syncOutboxEvents(organizationId); setMessage(`Outbox sync complete: ${result.completed} delivered.`); await load(); }, [organizationId, mode, load]);
  const refreshCheckpoint = useCallback(async () => {
    if (!organizationId || mode !== "online") return;
    setMessage("Refreshing server checkpoint…");
    const result = await refreshDeviceCheckpoint(organizationId);
    if (result.ok) { setRemoteCheckpoint(result.checkpoint.serverCheckpoint); setMessage(`Server checkpoint ${result.checkpoint.serverCheckpoint}.`); }
    else setMessage(`Checkpoint refresh blocked: ${result.reason}`);
    await load();
  }, [organizationId, mode, load]);
  const reconcile = useCallback(async () => { if (!organizationId || mode !== "online") return; setMessage("Reconciling cloud changes…"); const result = await reconcileCloud(organizationId); setMessage(result.ok ? `Cloud reconciliation complete: ${result.outboxAcked} ACKed, ${result.pullPages} pull pages.` : `Cloud reconciliation blocked: ${result.reason}`); await load(); }, [organizationId, mode, load]);
  const syncStoreHub = useCallback(async () => {
    if (!organizationId) return;
    setMessage("Synchronizing with Store Hub…");
    const result = await synchronizeWithStoreHub(organizationId);
    setMessage(
      result.ok
        ? `Store Hub sync complete: ${result.published} published, ${result.pulled} pulled.`
        : `Store Hub sync unavailable: ${result.reason}`,
    );
    await load();
  }, [organizationId, load]);

  const reauthenticateForRecovery = useCallback(async () => {
    if (!organizationId || recoveryBusy || !recoveryEmail.trim() || !recoveryPassword) return;
    setRecoveryBusy(true);
    setMessage("Reauthenticating without releasing transaction custody…");
    try {
      const result = await reauthenticate(recoveryEmail, recoveryPassword, organizationId);
      setRecoveryPassword("");
      if (result.ok) {
        await reload(organizationId);
        setMessage("Authentication refreshed. Review and retry the blocked transaction.");
      } else {
        setMessage(result.message);
      }
      await load();
    } catch {
      setMessage("Reauthentication is unavailable. Local transactions remain protected.");
    } finally {
      setRecoveryBusy(false);
    }
  }, [load, organizationId, reauthenticate, recoveryBusy, recoveryEmail, recoveryPassword, reload]);

  const retryRecoveryEvent = useCallback(async (eventId: string) => {
    if (!organizationId || !data?.core || !identity || accessMode !== "online" || recoveryBusy) return;
    setRecoveryBusy(true);
    setMessage("Authorizing same-identity recovery retry…");
    try {
      const result = await retryReviewedOutboxEvent({
        organizationId,
        eventId,
        reason: recoveryNote,
        core: data.core,
        identity,
      });
      setMessage(
        result.ok
          ? `Recovery retry completed: ${result.report.completed} delivered.`
          : `Recovery retry blocked: ${result.reason}`,
      );
      if (result.ok) setRecoveryNote("");
      await reload(organizationId);
      await load();
    } catch {
      setMessage("Recovery retry could not be completed. The saved transaction remains protected.");
      await load();
    } finally {
      setRecoveryBusy(false);
    }
  }, [accessMode, data, identity, load, organizationId, recoveryBusy, recoveryNote, reload]);

  const createA30Queue = useCallback(async (count: 100 | 1_000) => {
    if (!data?.core || !identity?.binding || a30Busy) return;
    setA30Busy(true);
    setA30Progress(0);
    setA30Result(null);
    setMessage(`Creating ${count} synthetic durable sales through the production acceptance path…`);
    try {
      const result = await createMob10A30Queue({
        organizationId: data.core.organization.id,
        organizationName: data.core.organization.name,
        binding: identity.binding,
        deviceId: identity.credential.deviceId,
        count,
        isOffline: mode === "offline",
        isPrepared: offlineState === "READY",
        onProgress: setA30Progress,
      });
      setA30Result(result);
      setMessage(result.ok
        ? `A30 queue ready: ${result.accepted} durable synthetic sales. Reconnect, then sync the durable outbox.`
        : `A30 queue stopped after ${result.accepted}: ${result.reason}. Accepted records remain in custody.`);
      await load();
    } finally {
      setA30Busy(false);
    }
  }, [a30Busy, data, identity, load, mode, offlineState]);

  const sequenceHealth = !sequenceState ? "CHECK REQUIRED" : outbox?.oldestUnresolved && outbox.oldestUnresolved.deviceSequence > sequenceState.serverCheckpoint + 1 ? "GAP DETECTED" : "CONTIGUOUS";

  const performance = getPerformanceMetrics();
  const visibleRecoveryItems = recoveryItems.filter((event) =>
    data?.core.storeIds.includes(event.storeId),
  );
  const hiddenRecoveryCount = recoveryItems.length - visibleRecoveryItems.length;

  return <ScrollView
    automaticallyAdjustKeyboardInsets
    contentContainerStyle={{ padding: 20, paddingBottom: 48, gap: 8 }}
    keyboardDismissMode="on-drag"
    keyboardShouldPersistTaps="handled"
    testID="sync-status-scroll"
  >
    <Text>Cloud Backend: {mode === "offline" ? "OFFLINE" : "CONNECTED / CHECK REQUIRED"}</Text><Text>Native SQLite: {health?.ready ? "READY — PHASE 07" : "CHECK REQUIRED"}</Text><Text>SQLite schema: {health?.schemaVersion ?? 0}/{health?.expectedSchemaVersion ?? 2}</Text><Text>SQLite integrity: {health?.integrity === "ok" ? "OK" : "CHECK REQUIRED"}</Text><Text>Business context cached: {cached === null ? "UNKNOWN" : cached ? "YES" : "NO"}</Text><Text>Business context rows: {stats?.businessContext ?? 0}</Text><Text>Reference snapshots: {stats?.reference ?? 0}</Text><Text>Catalog items: {stats?.catalog ?? 0}</Text><Text>Observed customers: {stats?.customers ?? 0}</Text><Text>Shift snapshots: {stats?.shifts ?? 0}</Text><Text>Receipt summaries: {stats?.receipts ?? 0}</Text><Text>Persistence verified: {health?.persistenceVerifiedAt ?? "NOT YET"}</Text><Text>Restart proof: {restartProof ? `${restartProof.organizationId} at ${restartProof.armedAt}` : "NOT ARMED"}</Text>
    <Text>Phase 08 Offline Authorization: {offlineState}</Text><Text>Offline authorization expires: {grant?.expiresAt ?? "NOT PREPARED"}</Text><Text>Offline organization: {grant?.organizationId ?? "—"}</Text><Text>Offline store / register: {grant ? `${grant.storeId} / ${grant.registerId}` : "—"}</Text><Text>Offline shift: {grant?.shiftId ?? "—"}</Text><Text>Complete catalog: {offlineState === "READY" ? "YES" : "NO"}</Text><Text>Cached catalog items: {stats?.catalog ?? 0}</Text><Text>Reference/configuration: {stats?.reference ? "READY" : "MISSING"}</Text>{message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    <Pressable onPress={() => void verify()}><Text>Verify SQLite persistence</Text></Pressable><Pressable onPress={() => void arm()}><Text>Arm Phase 07 restart proof</Text></Pressable><Pressable disabled={mode !== "online"} onPress={() => void prepare()}><Text>Prepare Offline Mode</Text></Pressable><Pressable onPress={() => void revoke()}><Text>Revoke Offline Authorization</Text></Pressable><Pressable accessibilityRole="button" testID="recheck-backend" onPress={() => void recheck()}><Text>Recheck Backend</Text></Pressable>
    <Text>Cold-start Offline: PHASE 08</Text><Text>Phase 09 Local-First: IMPLEMENTED</Text><Text>Catalog source: SQLite</Text><Text>Local-first metrics: SQLite catalog reads {getLocalFirstMetrics().sqliteCatalogReads}; SQLite barcode reads {getLocalFirstMetrics().sqliteBarcodeReads}; SQLite reference reads {getLocalFirstMetrics().sqliteReferenceReads}; modifier cache hits {getLocalFirstMetrics().modifierCacheHits}; modifier network fallbacks {getLocalFirstMetrics().modifierNetworkFallbacks}; cloud catalog searches {getLocalFirstMetrics().cloudCatalogSearches}</Text>
    <Text>Durable Outbox: PHASE 10</Text><Text>Outbox pending / syncing / conflict / failed: {outbox?.summary.pending ?? 0} / {outbox?.summary.syncing ?? 0} / {outbox?.summary.conflict ?? 0} / {outbox?.summary.failed ?? 0}</Text><Text>Oldest unresolved: {outbox?.oldestUnresolved ? `${outbox.oldestUnresolved.localReference} — sequence ${outbox.oldestUnresolved.deviceSequence} — ${outbox.oldestUnresolved.state} — ${outbox.oldestUnresolved.totalMinor} ${outbox.oldestUnresolved.currencyCode}` : "NONE"}</Text><Pressable accessibilityRole="button" testID="sync-durable-outbox" disabled={mode !== "online"} onPress={() => void syncOutbox()}><Text>Sync durable outbox now</Text></Pressable>
    {isMob10A30CertificationBuild() ? <View>
      <Text>MOB-10 A30 SYNTHETIC QUEUE CERTIFICATION</Text>
      <Text>Safety gate: certification organization/product, prepared offline terminal, and empty unresolved queue required.</Text>
      <Text>Queue creation progress: {a30Progress}</Text>
      {a30Result?.ok ? <>
        <Text>A30 accepted / duration: {a30Result.accepted} / {a30Result.durationMs} ms</Text>
        <Text>A30 sequence range: {a30Result.firstSequence}–{a30Result.lastSequence}</Text>
        <Text>A30 first identity: {a30Result.firstEventId} / {a30Result.firstIdempotencyKey}</Text>
        <Text>A30 last identity: {a30Result.lastEventId} / {a30Result.lastIdempotencyKey}</Text>
        <Text>A30 total / expected stock delta: {a30Result.totalMinor} minor / {a30Result.expectedStockDelta}</Text>
        <Text>A30 product: {a30Result.productName} / {a30Result.productId}</Text>
      </> : a30Result ? <Text>A30 stopped after {a30Result.accepted}: {a30Result.reason}</Text> : null}
      <Pressable accessibilityRole="button" testID="create-a30-100" disabled={a30Busy} onPress={() => void createA30Queue(100)}><Text>Create A30 100-sale queue</Text></Pressable>
      <Pressable accessibilityRole="button" testID="create-a30-1000" disabled={a30Busy} onPress={() => void createA30Queue(1_000)}><Text>Create A30 1,000-sale queue</Text></Pressable>
    </View> : null}
    <Text>MOB-04 TRANSACTION RECOVERY</Text>
    <Text>Authentication state: {accessMode === "online" ? "ONLINE AUTHENTICATED" : "REAUTHENTICATION REQUIRED"}</Text>
    <TextInput accessibilityLabel="Recovery employee email" autoCapitalize="none" autoComplete="email" editable={!recoveryBusy} keyboardType="email-address" onChangeText={setRecoveryEmail} placeholder="Recovery employee email" value={recoveryEmail} />
    <TextInput accessibilityLabel="Recovery employee password" autoComplete="current-password" editable={!recoveryBusy} onChangeText={setRecoveryPassword} placeholder="Password" secureTextEntry value={recoveryPassword} />
    <Pressable accessibilityRole="button" disabled={recoveryBusy || !recoveryEmail.trim() || !recoveryPassword} onPress={() => void reauthenticateForRecovery()}><Text>Reauthenticate in place</Text></Pressable>
    <TextInput accessibilityLabel="Manager recovery note" editable={!recoveryBusy} onChangeText={setRecoveryNote} placeholder="Manager recovery note (required for review)" value={recoveryNote} />
    {visibleRecoveryItems.map((event) => {
      const decision = identity?.binding && data?.core
        ? evaluateOutboxRecovery(event, {
            organizationId: data.core.organization.id,
            profileId: data.core.profileId,
            employeeId: data.core.employee.id,
            permissions: data.core.permissions,
            storeIds: data.core.storeIds,
            deviceId: identity.credential.deviceId,
            storeId: identity.binding.storeId,
            registerId: identity.binding.registerId,
          })
        : { ok: false as const, reason: "DEVICE_REVALIDATION_REQUIRED" };
      return <View key={event.eventId}>
        <Text>{event.localReference} — sequence {event.deviceSequence ?? "CORRUPT"} — {event.state}</Text>
        <Text>{event.corrupt ? "Damaged local record; escalation required." : `${event.totalMinor ?? "?"} ${event.currencyCode ?? ""} — ${event.itemCount ?? "?"} item(s)`}</Text>
        <Text>{event.conflictType ?? "NO CLASSIFICATION"}: {event.lastError ?? "No error detail recorded."}</Text>
        {decision.ok ? <Pressable accessibilityRole="button" disabled={accessMode !== "online" || recoveryBusy} onPress={() => void retryRecoveryEvent(event.eventId)}><Text>Retry original transaction</Text></Pressable> : <Text>Recovery blocked: {decision.reason}</Text>}
      </View>;
    })}
    {hiddenRecoveryCount > 0 ? <Text>{hiddenRecoveryCount} unresolved transaction(s) are hidden because this employee is not assigned to their store. Custody remains protected.</Text> : null}
    <Text>PHASE 11 DEVICE SEQUENCE</Text><Text>Device: {deviceId ?? "NOT AVAILABLE"}</Text><Text>Next local sequence: {sequenceState?.nextSequence ?? "CHECK REQUIRED"}</Text><Text>Local known server checkpoint: {sequenceState?.serverCheckpoint ?? "CHECK REQUIRED"}</Text><Text>Remote server checkpoint: {remoteCheckpoint ?? "NOT CHECKED"}</Text><Text>Next expected server sequence: {sequenceState ? sequenceState.serverCheckpoint + 1 : "CHECK REQUIRED"}</Text><Text>Sequence health: {sequenceHealth}</Text><Pressable accessibilityRole="button" accessibilityLabel="Refresh server checkpoint" testID="refresh-server-checkpoint" disabled={mode !== "online"} onPress={() => void refreshCheckpoint()}><Text>Refresh Server Checkpoint</Text></Pressable>
    <Text>PHASE 12 CLOUD RECONCILIATION</Text><Text>Delta sync: {cursor?.initialized ? "INITIALIZED" : "NOT INITIALIZED"}</Text><Text>Pull cursor: {cursor?.pullCursor ?? 0}</Text><Text>Last push: {cursor?.lastPushAt ?? "NEVER"}</Text><Text>Last pull: {cursor?.lastPullAt ?? "NEVER"}</Text><Text>Last reconciliation: {cursor?.lastReconcileAt ?? "NEVER"}</Text><Text>Last sync error: {cursor?.lastError ?? "NONE"}</Text><Text>Server changes remaining: UNKNOWN UNTIL RECONCILE</Text><Pressable disabled={mode !== "online"} onPress={() => void reconcile()}><Text>Reconcile With Cloud</Text></Pressable>
    <Text>PHASE 16 ISOLATED DEVICE MODE</Text>
    <Text>Persisted mode: {isolatedDiagnostics?.connectionMode ?? "UNKNOWN"}</Text>
    <Text>Mode changed at: {isolatedDiagnostics?.connectionChangedAt ?? "UNKNOWN"}</Text>
    <Text>Unresolved transactions: {isolatedDiagnostics?.unresolvedTransactions ?? 0}</Text>
    <Text>Pending / syncing / conflict / failed: {isolatedDiagnostics?.pendingTransactions ?? 0} / {isolatedDiagnostics?.syncingTransactions ?? 0} / {isolatedDiagnostics?.conflictTransactions ?? 0} / {isolatedDiagnostics?.failedTransactions ?? 0}</Text>
    <Text>Oldest unresolved: {isolatedDiagnostics?.oldestUnresolvedReference ?? "NONE"} / {isolatedDiagnostics?.oldestUnresolvedState ?? "—"}</Text>
    <Text>Next device sequence: {isolatedDiagnostics?.nextDeviceSequence ?? "UNKNOWN"}</Text>
    <Text>Server checkpoint: {isolatedDiagnostics?.serverCheckpoint ?? "UNKNOWN"}</Text>
    <Text>Pull cursor: {isolatedDiagnostics?.pullCursor ?? "UNKNOWN"}</Text>
    <Text>Last cloud reconcile: {isolatedDiagnostics?.lastReconcileAt ?? "NEVER"}</Text>
    <Text>Offline authorization: {isolatedDiagnostics?.offlineAuthorization ?? "UNKNOWN"}</Text>
    <Text>Recovery safe for CLOUD_ONLINE: {isolatedDiagnostics?.recoverySafeForCloudOnline ? "YES" : "NO"}</Text>
    <Text>PHASE 15 STORE LOCAL MODE / STORE HUB</Text>
    <Text>Connection mode: {connectionMode}</Text>
    <Text>Store Hub URL: {storeHubState?.hubUrl ?? "NOT CONFIGURED / NOT CONTACTED"}</Text>
    <Text>Store Hub cursor: {storeHubState?.pullCursor ?? 0}</Text>
    <Text>Store Hub last contact: {storeHubState?.lastContactAt ?? "NEVER"}</Text>
    <Text>Store Hub last error: {storeHubState?.lastError ?? "NONE"}</Text>
    <Pressable onPress={() => void syncStoreHub()}><Text>Synchronize With Store Hub</Text></Pressable>
    <Text>Store Hub ACK never replaces cloud ACK.</Text>
    <Text>PHASE 14 OFFLINE INVENTORY INTELLIGENCE</Text>
    <Text>Authority: {inventoryDiagnostics?.authority ?? "SERVER_LEDGER_AUTHORITATIVE"}</Text>
    <Text>Local intelligence scope: {inventoryDiagnostics?.localScope ?? "CURRENT_DEVICE_ONLY"}</Text>
    <Text>Cached cloud stock baselines: {inventoryDiagnostics?.baselineCount ?? 0}</Text>
    <Text>Oldest stock baseline: {inventoryDiagnostics?.oldestBaselineAt ?? "NONE"}</Text>
    <Text>Newest stock baseline: {inventoryDiagnostics?.newestBaselineAt ?? "NONE"}</Text>
    <Text>Unresolved local sale events: {inventoryDiagnostics?.unresolvedSaleCount ?? 0}</Text>
    <Text>Affected saleables on this device: {inventoryDiagnostics?.unresolvedAffectedSaleables ?? 0}</Text>
    <Text>Other offline devices are intentionally UNKNOWN until later store-local coordination.</Text>
    <Text>Phase 14 implementation: COMPLETE — CERTIFICATION DEFERRED</Text>
    <Text>PHASE 22 PERFORMANCE + COST</Text>
    <Text>API calls: {performance.apiCalls}</Text>
    <Text>SQLite search latency avg / max ms: {performance.sqliteAverageLatencyMs.toFixed(1)} / {performance.sqliteMaxLatencyMs}</Text>
    <Text>Sync throughput records/sec: {performance.syncThroughputPerSecond.toFixed(2)}</Text>
    <Text>Recovery duration avg / max ms: {performance.recoveryAverageDurationMs.toFixed(1)} / {performance.recoveryMaxDurationMs}</Text>
    <Pressable onPress={() => { resetPerformanceMetrics(); setMessage("Phase 22 performance window reset."); }}><Text>Reset Phase 22 performance window</Text></Pressable>
  </ScrollView>;
}
