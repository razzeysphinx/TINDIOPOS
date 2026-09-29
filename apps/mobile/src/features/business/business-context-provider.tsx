import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { saveBusinessContextSnapshot } from "../../db/business-context-cache";
import { saveActiveShiftSnapshot } from "../../db/shift-cache";
import { isExplicitAuthorizationDenial, fetchPosV2Core } from "../../lib/tindio-api";
import { evaluateOfflineReadiness } from "../offline/offline-readiness";
import { useSession } from "../session/session-provider";

type Value = { data: PosBootstrapV2CoreResponse | null; loading: boolean; error: string | null; mode: "online" | "offline"; offlineExpiresAt: string | null; reload(organizationId?: string): Promise<void> };
const Context = createContext<Value | null>(null);

function cachedBootstrap(core: PosBootstrapV2CoreResponse["core"]): PosBootstrapV2CoreResponse { return { ok: true, version: 2, requestId: `offline-cache:${Date.now()}`, core }; }

export function BusinessContextProvider({ children }: PropsWithChildren) {
  const { accessMode, offlineExpiresAt } = useSession();
  const [data, setData] = useState<PosBootstrapV2CoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"online" | "offline">("online");
  const loadOffline = useCallback(async () => {
    const readiness = await evaluateOfflineReadiness();
    if (!readiness.ok) { setData(null); setError("Offline access is not prepared for this terminal."); return false; }
    setData(cachedBootstrap(readiness.core)); setMode("offline"); setError(null); return true;
  }, []);
  const reload = useCallback(async (organizationId?: string) => {
    setLoading(true); setError(null);
    if (accessMode === "offline") { await loadOffline(); setLoading(false); return; }
    try {
      const next = await fetchPosV2Core(organizationId);
      setData(next); setMode("online");
      try { await saveBusinessContextSnapshot(next.core); await saveActiveShiftSnapshot(next.core.organization.id, next.core.activeShift); } catch { /* The online response remains authoritative. */ }
    } catch (caught) {
      if (isExplicitAuthorizationDenial(caught)) { setData(null); setError("TINDIO requires online authorization."); }
      else if (!(await loadOffline())) setError("TINDIO could not load this business context.");
    } finally { setLoading(false); }
  }, [accessMode, loadOffline]);
  useEffect(() => { const timer = setTimeout(() => void reload(), 0); return () => clearTimeout(timer); }, [reload]);
  const value = useMemo(() => ({ data, loading, error, mode, offlineExpiresAt: mode === "offline" ? offlineExpiresAt : null, reload }), [data, loading, error, mode, offlineExpiresAt, reload]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useBusinessContext() { const value = useContext(Context); if (!value) throw new Error("useBusinessContext must be used inside BusinessContextProvider."); return value; }
