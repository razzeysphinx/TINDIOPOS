import type { Session } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { AppState } from "react-native";
import { fetchPosV2Core } from "../../lib/tindio-api";
import { supabase } from "../../lib/supabase";
type Result = { ok: true } | { ok: false; message: string };
type Value = { session: Session | null; loading: boolean; signIn(email: string, password: string): Promise<Result>; signOut(): Promise<void> };
const Context = createContext<Value | null>(null);
export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null); const [loading, setLoading] = useState(true);
  useEffect(() => { let active = true; void supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setLoading(false); } }); const auth = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false); }).data.subscription; const app = AppState.addEventListener("change", (state) => state === "active" ? supabase.auth.startAutoRefresh() : supabase.auth.stopAutoRefresh()); supabase.auth.startAutoRefresh(); return () => { active = false; auth.unsubscribe(); app.remove(); supabase.auth.stopAutoRefresh(); }; }, []);
  const signIn = useCallback(async (email: string, password: string): Promise<Result> => { const result = await supabase.auth.signInWithPassword({ email: email.trim(), password }); if (result.error || !result.data.session) return { ok: false, message: "Email or password is incorrect." }; try { await fetchPosV2Core(); return { ok: true }; } catch { await supabase.auth.signOut(); return { ok: false, message: "This account could not open TINDIO POS." }; } }, []);
  const signOut = useCallback(async () => { await supabase.auth.signOut(); }, []);
  const value = useMemo(() => ({ session, loading, signIn, signOut }), [session, loading, signIn, signOut]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession() { const value = useContext(Context); if (!value) throw new Error("useSession must be used inside SessionProvider."); return value; }
