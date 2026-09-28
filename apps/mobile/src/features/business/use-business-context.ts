import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { useCallback, useEffect, useState } from "react";
import { fetchPosV2Core } from "../../lib/tindio-api";
export function useBusinessContext() { const [data, setData] = useState<PosBootstrapV2CoreResponse | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const load = useCallback(async (organizationId?: string) => { setLoading(true); setError(null); try { setData(await fetchPosV2Core(organizationId)); } catch { setError("TINDIO could not load this business context."); } finally { setLoading(false); } }, []); useEffect(() => { void load(); }, [load]); return { data, loading, error, reload: load }; }
