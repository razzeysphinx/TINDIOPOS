import type {
  PosBootstrapV2CoreResponse,
} from "../../../../../src/contracts/pos";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import {
  saveBusinessContextSnapshot,
} from "../../db/business-context-cache";
import {
  saveActiveShiftSnapshot,
} from "../../db/shift-cache";
import {
  isExplicitAuthorizationDenial,
  fetchPosV2Core,
} from "../../lib/tindio-api";
import {
  loadMobileDeviceIdentity,
} from "../device/device-store";
import {
  evaluateOfflineReadiness,
} from "../offline/offline-readiness";
import {
  probeStoreHub,
} from "../store-hub/store-hub-client";
import {
  synchronizeWithStoreHub,
} from "../store-hub/store-hub-sync";
import {
  useSession,
} from "../session/session-provider";

export type MobileConnectionMode =
  | "CLOUD_ONLINE"
  | "STORE_LOCAL"
  | "DEVICE_ISOLATED";

type Value = {
  data: PosBootstrapV2CoreResponse | null;
  loading: boolean;
  error: string | null;
  mode: "online" | "offline";
  connectionMode: MobileConnectionMode;
  offlineExpiresAt: string | null;
  reload(organizationId?: string): Promise<void>;
};

const Context = createContext<Value | null>(null);

function cachedBootstrap(
  core: PosBootstrapV2CoreResponse["core"],
): PosBootstrapV2CoreResponse {
  return {
    ok: true,
    version: 2,
    requestId: `offline-cache:${Date.now()}`,
    core,
  };
}

export function BusinessContextProvider({
  children,
}: PropsWithChildren) {
  const {
    accessMode,
    offlineExpiresAt,
  } = useSession();

  const [data, setData] =
    useState<PosBootstrapV2CoreResponse | null>(null);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState<string | null>(null);
  const [mode, setMode] =
    useState<"online" | "offline">("online");
  const [connectionMode, setConnectionMode] =
    useState<MobileConnectionMode>("CLOUD_ONLINE");

  const loadOffline = useCallback(async () => {
    const readiness =
      await evaluateOfflineReadiness();

    if (!readiness.ok) {
      setData(null);
      setError(
        "Offline access is not prepared for this terminal.",
      );
      return false;
    }

    const core = readiness.core;

    setData(cachedBootstrap(core));
    setMode("offline");
    setError(null);

    const identity =
      await loadMobileDeviceIdentity(
        core.organization.id,
      );

    if (!identity?.binding) {
      setConnectionMode("DEVICE_ISOLATED");
      return true;
    }

    const hub = await probeStoreHub({
      organizationId: core.organization.id,
      storeId: identity.binding.storeId,
    });

    if (hub.ok) {
      setConnectionMode("STORE_LOCAL");

      void synchronizeWithStoreHub(
        core.organization.id,
      );

      return true;
    }

    setConnectionMode("DEVICE_ISOLATED");
    return true;
  }, []);

  const reload = useCallback(
    async (organizationId?: string) => {
      setLoading(true);
      setError(null);

      if (accessMode === "offline") {
        await loadOffline();
        setLoading(false);
        return;
      }

      try {
        const next =
          await fetchPosV2Core(organizationId);

        setData(next);
        setMode("online");
        setConnectionMode("CLOUD_ONLINE");

        try {
          await saveBusinessContextSnapshot(
            next.core,
          );
          await saveActiveShiftSnapshot(
            next.core.organization.id,
            next.core.activeShift,
          );
        } catch {
          // Cloud response remains authoritative.
        }
      } catch (caught) {
        if (isExplicitAuthorizationDenial(caught)) {
          setData(null);
          setError(
            "TINDIO requires online authorization.",
          );
        } else if (!(await loadOffline())) {
          setError(
            "TINDIO could not load this business context.",
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [accessMode, loadOffline],
  );

  useEffect(() => {
    const timer = setTimeout(
      () => void reload(),
      0,
    );

    return () => clearTimeout(timer);
  }, [reload]);

  const value = useMemo(
    () => ({
      data,
      loading,
      error,
      mode,
      connectionMode,
      offlineExpiresAt:
        mode === "offline"
          ? offlineExpiresAt
          : null,
      reload,
    }),
    [
      data,
      loading,
      error,
      mode,
      connectionMode,
      offlineExpiresAt,
      reload,
    ],
  );

  return (
    <Context.Provider value={value}>
      {children}
    </Context.Provider>
  );
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
