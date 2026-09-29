import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import { fetchPosV2Core } from "../../lib/tindio-api";
import { supabase } from "../../lib/supabase";
import { clearOfflineAuthorizationGrant } from "../offline/offline-authorization";
import { evaluateOfflineReadiness } from "../offline/offline-readiness";

type Result = { ok: true } | { ok: false; message: string };
export type AccessMode = "online" | "offline" | "signed-out";
type Value = { session: Session | null; loading: boolean; accessMode: AccessMode; offlineExpiresAt: string | null; signIn(email: string, password: string): Promise<Result>; signOut(): Promise<void>; refreshOfflineAccess(): Promise<void> };
const Context = createContext<Value | null>(null);

function isUnexpired(session: Session | null) { return Boolean(session && (!session.expires_at || session.expires_at * 1000 > Date.now())); }

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessMode, setAccessMode] = useState<AccessMode>("signed-out");
  const [offlineExpiresAt, setOfflineExpiresAt] = useState<string | null>(null);
  const applyOfflineReadiness = useCallback(async () => {
    const readiness = await evaluateOfflineReadiness();
    if (readiness.ok) { setAccessMode("offline"); setOfflineExpiresAt(readiness.grant.expiresAt); return; }
    setAccessMode("signed-out"); setOfflineExpiresAt(null);
  }, []);
  const refreshOfflineAccess = useCallback(async () => { await applyOfflineReadiness(); }, [applyOfflineReadiness]);

  useEffect(() => {
    let active = true;
    const start = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session);
      if (isUnexpired(data.session)) { setAccessMode("online"); setOfflineExpiresAt(null); } else { await applyOfflineReadiness(); }
      if (active) setLoading(false);
    };
    const timer = setTimeout(() => void start(), 0);
    const auth = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (isUnexpired(next)) { setAccessMode("online"); setOfflineExpiresAt(null); } else { void applyOfflineReadiness(); }
      setLoading(false);
    }).data.subscription;
    const app = AppState.addEventListener("change", (state) => state === "active" ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh());
    supabase.auth.startAutoRefresh();
    return () => { active = false; clearTimeout(timer); auth.unsubscribe(); app.remove(); supabase.auth.stopAutoRefresh(); };
  }, [applyOfflineReadiness]);

  const signIn = useCallback(async (email: string, password: string): Promise<Result> => {
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error || !result.data.session) return { ok: false, message: "Email or password is incorrect." };
    try { await fetchPosV2Core(); setSession(result.data.session); setAccessMode("online"); setOfflineExpiresAt(null); return { ok: true }; }
    catch { await supabase.auth.signOut(); return { ok: false, message: "This account could not open TINDIO POS." }; }
  }, []);
  const signOut = useCallback(async () => { await clearOfflineAuthorizationGrant(); await supabase.auth.signOut(); setSession(null); setAccessMode("signed-out"); setOfflineExpiresAt(null); }, []);
  const value = useMemo(() => ({ session, loading, accessMode, offlineExpiresAt, signIn, signOut, refreshOfflineAccess }), [session, loading, accessMode, offlineExpiresAt, signIn, signOut, refreshOfflineAccess]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error("useSession must be used inside SessionProvider."); return value; }
