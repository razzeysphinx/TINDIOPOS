import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getOrganizationCacheStats, type OrganizationCacheStats } from "../../src/db/cache-stats";
import { hasBusinessContextSnapshot } from "../../src/db/business-context-cache";
import { armPhase07RestartProof, getLocalDatabaseHealth, readPhase07RestartProof, type Phase07RestartProof, verifyLocalPersistence } from "../../src/db/health";
import { clearOfflineAuthorizationGrant, readOfflineAuthorizationGrant, validateOfflineAuthorizationGrant, type OfflineAuthorizationGrant } from "../../src/features/offline/offline-authorization";
import { prepareOfflineMode } from "../../src/features/offline/prepare-offline-mode";
import { useBusinessContext } from "../../src/features/business/use-business-context";
import { getLocalFirstMetrics } from "../../src/features/local-first/runtime-metrics";
import { getSafeOutboxDiagnostics } from "../../src/features/outbox/outbox-summary";
import { syncOutboxEvents } from "../../src/features/outbox/outbox-sync";

export default function SyncStatusScreen() {
  const { data, reload, mode } = useBusinessContext();
  const organizationId = data?.core.organization.id;
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getLocalDatabaseHealth>> | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [stats, setStats] = useState<OrganizationCacheStats | null>(null);
  const [restartProof, setRestartProof] = useState<Phase07RestartProof | null>(null);
  const [grant, setGrant] = useState<OfflineAuthorizationGrant | null>(null);
  const [offlineState, setOfflineState] = useState("NOT PREPARED");
  const [message, setMessage] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<Awaited<ReturnType<typeof getSafeOutboxDiagnostics>> | null>(null);

  const load = useCallback(async () => {
    setHealth(await getLocalDatabaseHealth());
    setRestartProof(await readPhase07RestartProof());
    const savedGrant = await readOfflineAuthorizationGrant();
    setGrant(savedGrant);
    const authorization = await validateOfflineAuthorizationGrant();
    setOfflineState(authorization.ok ? "READY" : authorization.reason === "EXPIRED" ? "EXPIRED" : savedGrant ? "BLOCKED" : "NOT PREPARED");
    if (organizationId) {
      setCached(await hasBusinessContextSnapshot(organizationId));
      setStats(await getOrganizationCacheStats(organizationId));
      setOutbox(await getSafeOutboxDiagnostics(organizationId));
    }
  }, [organizationId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const verify = useCallback(async () => { await verifyLocalPersistence(); await load(); }, [load]);
  const arm = useCallback(async () => { if (organizationId) setRestartProof(await armPhase07RestartProof(organizationId)); }, [organizationId]);
  const prepare = useCallback(async () => {
    if (!organizationId || mode !== "online") return;
    setMessage("Preparing offline mode…");
    const result = await prepareOfflineMode(organizationId);
    setMessage(result.ok ? `OFFLINE READY UNTIL ${result.expiresAt}` : `Offline preparation blocked: ${result.reason}`);
    await load();
  }, [organizationId, mode, load]);
  const revoke = useCallback(async () => { await clearOfflineAuthorizationGrant(); setMessage("Offline authorization revoked."); await load(); }, [load]);
  const syncOutbox = useCallback(async () => {
    if (!organizationId || mode !== "online") return;
    setMessage("Syncing durable outbox…");
    const result = await syncOutboxEvents(organizationId);
    setMessage(`Outbox sync complete: ${result.completed} delivered.`);
    await load();
  }, [organizationId, mode, load]);

  return <View>
    <Text>Cloud Backend: {mode === "offline" ? "OFFLINE" : "CONNECTED / CHECK REQUIRED"}</Text><Text>Native SQLite: {health?.ready ? "READY — PHASE 07" : "CHECK REQUIRED"}</Text><Text>SQLite schema: {health?.schemaVersion ?? 0}/{health?.expectedSchemaVersion ?? 2}</Text><Text>SQLite integrity: {health?.integrity === "ok" ? "OK" : "CHECK REQUIRED"}</Text><Text>Business context cached: {cached === null ? "UNKNOWN" : cached ? "YES" : "NO"}</Text><Text>Business context rows: {stats?.businessContext ?? 0}</Text><Text>Reference snapshots: {stats?.reference ?? 0}</Text><Text>Catalog items: {stats?.catalog ?? 0}</Text><Text>Observed customers: {stats?.customers ?? 0}</Text><Text>Shift snapshots: {stats?.shifts ?? 0}</Text><Text>Receipt summaries: {stats?.receipts ?? 0}</Text><Text>Persistence verified: {health?.persistenceVerifiedAt ?? "NOT YET"}</Text><Text>Restart proof: {restartProof ? `${restartProof.organizationId} at ${restartProof.armedAt}` : "NOT ARMED"}</Text>
    <Text>Phase 08 Offline Authorization: {offlineState}</Text><Text>Offline authorization expires: {grant?.expiresAt ?? "NOT PREPARED"}</Text><Text>Offline organization: {grant?.organizationId ?? "—"}</Text><Text>Offline store / register: {grant ? `${grant.storeId} / ${grant.registerId}` : "—"}</Text><Text>Offline shift: {grant?.shiftId ?? "—"}</Text><Text>Complete catalog: {offlineState === "READY" ? "YES" : "NO"}</Text><Text>Cached catalog items: {stats?.catalog ?? 0}</Text><Text>Reference/configuration: {stats?.reference ? "READY" : "MISSING"}</Text>{message ? <Text>{message}</Text> : null}
    <Pressable onPress={() => void verify()}><Text>Verify SQLite persistence</Text></Pressable><Pressable onPress={() => void arm()}><Text>Arm Phase 07 restart proof</Text></Pressable><Pressable disabled={mode !== "online"} onPress={() => void prepare()}><Text>Prepare Offline Mode</Text></Pressable><Pressable onPress={() => void revoke()}><Text>Revoke Offline Authorization</Text></Pressable><Pressable onPress={() => void reload(organizationId)}><Text>Recheck Backend</Text></Pressable>
    <Text>Cold-start Offline: PHASE 08</Text><Text>Phase 09 Local-First: IMPLEMENTED</Text><Text>Catalog source: SQLite</Text><Text>Local-first metrics: SQLite catalog reads {getLocalFirstMetrics().sqliteCatalogReads}; SQLite barcode reads {getLocalFirstMetrics().sqliteBarcodeReads}; SQLite reference reads {getLocalFirstMetrics().sqliteReferenceReads}; modifier cache hits {getLocalFirstMetrics().modifierCacheHits}; modifier network fallbacks {getLocalFirstMetrics().modifierNetworkFallbacks}; cloud catalog searches {getLocalFirstMetrics().cloudCatalogSearches}</Text>
    <Text>Durable Outbox: PHASE 10</Text><Text>Outbox pending / syncing / conflict / failed: {outbox?.summary.pending ?? 0} / {outbox?.summary.syncing ?? 0} / {outbox?.summary.conflict ?? 0} / {outbox?.summary.failed ?? 0}</Text><Text>Oldest unresolved: {outbox?.oldestUnresolved ? `${outbox.oldestUnresolved.localReference} — ${outbox.oldestUnresolved.state} — ${outbox.oldestUnresolved.totalMinor} ${outbox.oldestUnresolved.currencyCode}` : "NONE"}</Text><Pressable disabled={mode !== "online"} onPress={() => void syncOutbox()}><Text>Sync durable outbox now</Text></Pressable>
    <Text>Device Checkpoints: NOT STARTED — PHASE 11</Text><Text>Delta Sync: NOT STARTED — PHASE 12</Text>
  </View>;
}
