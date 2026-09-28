import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { fetchPosV2Core } from "../../lib/tindio-api";
type Value = { data: PosBootstrapV2CoreResponse | null; loading: boolean; error: string | null; reload(organizationId?: string): Promise<void> };
const Context = createContext<Value | null>(null);
export function BusinessContextProvider({ children }: PropsWithChildren) { const [data, setData] = useState<PosBootstrapV2CoreResponse | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const reload = useCallback(async (organizationId?: string) => { setLoading(true); setError(null); try { setData(await fetchPosV2Core(organizationId)); } catch { setError("TINDIO could not load this business context."); } finally { setLoading(false); } }, []); useEffect(() => { void reload(); }, [reload]); const value = useMemo(() => ({ data, loading, error, reload }), [data, loading, error, reload]); return <Context.Provider value={value}>{children}</Context.Provider>; }
export function useBusinessContext() { const value = useContext(Context); if (!value) throw new Error("useBusinessContext must be used inside BusinessContextProvider."); return value; }
