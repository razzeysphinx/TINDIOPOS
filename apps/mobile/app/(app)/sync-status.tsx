import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { getOrganizationCacheStats, type OrganizationCacheStats } from "../../src/db/cache-stats";
import { hasBusinessContextSnapshot } from "../../src/db/business-context-cache";
import { armPhase07RestartProof, getLocalDatabaseHealth, readPhase07RestartProof, type Phase07RestartProof, verifyLocalPersistence } from "../../src/db/health";
import { useBusinessContext } from "../../src/features/business/use-business-context";

export default function SyncStatusScreen() {
  const { data, reload } = useBusinessContext();
  const organizationId = data?.core.organization.id;
  const [health, setHealth] = useState<Awaited<ReturnType<typeof getLocalDatabaseHealth>> | null>(null);
  const [cached, setCached] = useState<boolean | null>(null);
  const [stats, setStats] = useState<OrganizationCacheStats | null>(null);
  const [restartProof, setRestartProof] = useState<Phase07RestartProof | null>(null);

  const load = useCallback(async () => {
    setHealth(await getLocalDatabaseHealth());
    setRestartProof(await readPhase07RestartProof());
    if (organizationId) {
      setCached(await hasBusinessContextSnapshot(organizationId));
      setStats(await getOrganizationCacheStats(organizationId));
    }
  }, [organizationId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const verify = useCallback(async () => { await verifyLocalPersistence(); await load(); }, [load]);
  const arm = useCallback(async () => {
    if (!organizationId) return;
    setRestartProof(await armPhase07RestartProof(organizationId));
  }, [organizationId]);

  return <View>
    <Text>Cloud Backend: CONNECTED / CHECK REQUIRED</Text>
    <Text>Native SQLite: {health?.ready ? "READY — PHASE 07" : "CHECK REQUIRED"}</Text>
    <Text>SQLite schema: {health?.schemaVersion ?? 0}/{health?.expectedSchemaVersion ?? 2}</Text>
    <Text>SQLite journal: {health?.journalMode ?? "unknown"}</Text>
    <Text>SQLite integrity: {health?.integrity === "ok" ? "OK" : "CHECK REQUIRED"}</Text>
    <Text>Business context cached: {cached === null ? "UNKNOWN" : cached ? "YES" : "NO"}</Text>
    <Text>Business context rows: {stats?.businessContext ?? 0}</Text>
    <Text>Reference snapshots: {stats?.reference ?? 0}</Text>
    <Text>Catalog items: {stats?.catalog ?? 0}</Text>
    <Text>Observed customers: {stats?.customers ?? 0}</Text>
    <Text>Shift snapshots: {stats?.shifts ?? 0}</Text>
    <Text>Receipt summaries: {stats?.receipts ?? 0}</Text>
    <Text>Persistence verified: {health?.persistenceVerifiedAt ?? "NOT YET"}</Text>
    <Text>Restart proof: {restartProof ? `${restartProof.organizationId} at ${restartProof.armedAt}` : "NOT ARMED"}</Text>
    <Pressable onPress={() => void verify()}><Text>Verify SQLite persistence</Text></Pressable>
    <Pressable onPress={() => void arm()}><Text>Arm Phase 07 restart proof</Text></Pressable>
    <Pressable onPress={() => void reload(organizationId)}><Text>Recheck Backend</Text></Pressable>
    <Text>Cold-start Offline: NOT STARTED — PHASE 08</Text>
    <Text>Local-first Cache: NOT STARTED — PHASE 09</Text>
    <Text>Durable Outbox: NOT STARTED — PHASE 10</Text>
    <Text>Device Checkpoints: NOT STARTED — PHASE 11</Text>
    <Text>Delta Sync: NOT STARTED — PHASE 12</Text>
  </View>;
}
