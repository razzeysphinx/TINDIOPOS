import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { fetchPosV2Core } from "../../lib/tindio-api";
import { saveBusinessContextSnapshot } from "../../db/business-context-cache";
import { saveActiveShiftSnapshot } from "../../db/shift-cache";

type Value = {
  data: PosBootstrapV2CoreResponse | null;
  loading: boolean;
  error: string | null;
  reload(organizationId?: string): Promise<void>;
};

const Context = createContext<Value | null>(null);

export function BusinessContextProvider({
  children,
}: PropsWithChildren) {
  const [data, setData] = useState<PosBootstrapV2CoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (organizationId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const next = await fetchPosV2Core(organizationId);
      setData(next);
      try {
        await Promise.all([
          saveBusinessContextSnapshot(next.core),
          saveActiveShiftSnapshot(next.core.organization.id, next.core.activeShift),
        ]);
      } catch {
        // Online context remains usable if the local diagnostic cache fails.
      }
    } catch {
      setError("TINDIO could not load this business context.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void reload();
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [reload]);

  const value = useMemo(
    () => ({
      data,
      loading,
      error,
      reload,
    }),
    [data, loading, error, reload],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useBusinessContext() {
  const value = useContext(Context);

  if (!value) {
    throw new Error(
      "useBusinessContext must be used inside BusinessContextProvider.",
    );
  }

  return value;
}
