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
import { AppState } from "react-native";
import {
  getOutboxSummary,
} from "../../db/outbox";
import { getSyncCursor } from "../../db/sync-cursor";
import {
  saveBusinessContextSnapshot,
} from "../../db/business-context-cache";
import {
  saveActiveShiftSnapshot,
} from "../../db/shift-cache";
import {
  pruneUnauthorizedReceiptSummaries,
} from "../../db/receipt-cache";
import {
  fetchPosV2Core,
  isExplicitAuthorizationDenial,
} from "../../lib/tindio-api";
import {
  loadMobileDeviceIdentity,
} from "../device/device-store";
import {
  readConnectionModeState,
  writeConnectionModeState,
} from "../offline/connection-mode-state";
import {
  evaluateOfflineReadiness,
  evaluateRestrictedOfflineReadiness,
} from "../offline/offline-readiness";
import {
  deriveCashierReadinessState,
  evaluateOfflineAuthorizationLifecycle,
  nextOfflineAuthorizationCheckDelay,
  type CashierReadinessState,
} from "../offline/cashier-readiness-policy";
import { createForegroundReloadCoordinator } from "../offline/foreground-reload-coordinator";
import {
  shouldRecoverCloudEntry,
  shouldReloadAfterAppStateChange,
} from "../offline/lifecycle-policy";
import {
  recoverCloudConnection,
} from "../offline/recover-cloud-connection";
import {
  renewOfflineAuthorizationFromCloud,
} from "../offline/renew-offline-authorization";
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
  | "DEVICE_ISOLATED"
  | "RECOVERING"
  | "SYNC_REVIEW";

type Value = {
  data: PosBootstrapV2CoreResponse | null;
  loading: boolean;
  error: string | null;
  mode: "online" | "offline";
  connectionMode: MobileConnectionMode;
  offlineExpiresAt: string | null;
  cashierReadinessState: CashierReadinessState;
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
    offlineExpiresAt: sessionOfflineExpiresAt,
    offlineRestrictionReason,
    refreshOfflineAccess,
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
    useState<MobileConnectionMode>(
      "CLOUD_ONLINE",
    );

  const [preparedOfflineExpiresAt, setPreparedOfflineExpiresAt] =
    useState<string | null>(sessionOfflineExpiresAt);
  const [readinessCheckedAt, setReadinessCheckedAt] =
    useState(() => Date.now());

  const [reloadCoordinator] = useState(() =>
    createForegroundReloadCoordinator<void>(async () => undefined),
  );

  const setPersistedMode =
    useCallback(
      async (
        organizationId: string,
        nextMode: MobileConnectionMode,
      ) => {
        setConnectionMode(nextMode);

        try {
          await writeConnectionModeState(
            organizationId,
            nextMode,
          );
        } catch {
          // Runtime state remains valid even if diagnostics metadata cannot persist.
        }
      },
      [],
    );

  const loadOffline =
    useCallback(async () => {
      const readiness =
        await evaluateOfflineReadiness();

      if (!readiness.ok) {
        const restricted = offlineRestrictionReason
          ? await evaluateRestrictedOfflineReadiness()
          : null;

        if (!restricted?.ok) {
          setData(null);
          setMode("offline");
          setReadinessCheckedAt((previous) => Math.max(previous, Date.now()));
          setPreparedOfflineExpiresAt(null);
          setError(
            "PREPARATION REQUIRED — connect to prepare this terminal for offline work.",
          );
          return false;
        }

        const restrictedCore = restricted.core;
        setData(cachedBootstrap(restrictedCore));
        setMode("offline");
        setReadinessCheckedAt((previous) => Math.max(previous, Date.now()));
        setPreparedOfflineExpiresAt(restricted.grant.expiresAt);
        setError(null);
        await setPersistedMode(
          restrictedCore.organization.id,
          "DEVICE_ISOLATED",
        );
        return true;
      }

      const core = readiness.core;

      setData(cachedBootstrap(core));
      setMode("offline");
      setReadinessCheckedAt((previous) => Math.max(previous, Date.now()));
      setPreparedOfflineExpiresAt(readiness.grant.expiresAt);
      setError(null);

      const identity =
        await loadMobileDeviceIdentity(
          core.organization.id,
        );

      if (!identity?.binding) {
        await setPersistedMode(
          core.organization.id,
          "DEVICE_ISOLATED",
        );
        return true;
      }

      const hub = await probeStoreHub({
        organizationId:
          core.organization.id,
        storeId:
          identity.binding.storeId,
      });

      if (hub.ok) {
        await setPersistedMode(
          core.organization.id,
          "STORE_LOCAL",
        );

        void synchronizeWithStoreHub(
          core.organization.id,
        );

        return true;
      }

      await setPersistedMode(
        core.organization.id,
        "DEVICE_ISOLATED",
      );

      return true;
    }, [offlineRestrictionReason, setPersistedMode]);

  const completeCloudEntry =
    useCallback(
      async (
        next:
          PosBootstrapV2CoreResponse,
      ) => {
        const organizationId =
          next.core.organization.id;

        setData(next);

        try {
          await saveBusinessContextSnapshot(
            next.core,
          );

          await pruneUnauthorizedReceiptSummaries(
            organizationId,
            next.core.storeIds,
          );

          await saveActiveShiftSnapshot(
            organizationId,
            next.core.activeShift,
          );
        } catch {
          // Cloud response remains authoritative.
        }

        const [previousMode, outbox, identity] = await Promise.all([
          readConnectionModeState(
            organizationId,
          ),
          getOutboxSummary(
            organizationId,
          ),
          loadMobileDeviceIdentity(
            organizationId,
          ),
        ]);

        const cursor = identity?.binding
          ? await getSyncCursor(
              organizationId,
              identity.credential.deviceId,
              identity.binding.storeId,
            )
          : null;

        const unresolved =
          outbox.pending
          + outbox.syncing
          + outbox.conflict
          + outbox.failed;

        const needsRecovery = shouldRecoverCloudEntry({
          previousMode: previousMode?.mode ?? null,
          unresolvedTransactions: unresolved,
          terminalEnrolled: Boolean(identity?.binding),
          syncCursorInitialized: Boolean(cursor?.initialized),
        });

        if (!needsRecovery) {
          const renewal = await renewOfflineAuthorizationFromCloud(next.core);
          setPreparedOfflineExpiresAt(renewal.ok ? renewal.expiresAt : null);
          setMode("online");

          await setPersistedMode(
            organizationId,
            "CLOUD_ONLINE",
          );

          return;
        }

        // Network is reachable, but business mutations remain safely gated
        // until reconciliation is complete.
        setMode("offline");
        setReadinessCheckedAt((previous) => Math.max(previous, Date.now()));

        await setPersistedMode(
          organizationId,
          "RECOVERING",
        );

        const recovery =
          await recoverCloudConnection(
            organizationId,
          );

        if (recovery.ok) {
          const renewal = await renewOfflineAuthorizationFromCloud(next.core);
          setPreparedOfflineExpiresAt(renewal.ok ? renewal.expiresAt : null);
          setMode("online");

          await setPersistedMode(
            organizationId,
            "CLOUD_ONLINE",
          );

          return;
        }

        setMode("offline");

        await setPersistedMode(
          organizationId,
          recovery.mode,
        );
      },
      [setPersistedMode],
    );

  const performReload =
    useCallback(
      async (
        organizationId?: string,
      ) => {
        setLoading(true);
        setError(null);

        if (accessMode === "offline") {
          await loadOffline();
          setLoading(false);
          return;
        }

        try {
          const next =
            await fetchPosV2Core(
              organizationId,
            );

          await completeCloudEntry(next);
        } catch (caught) {
          if (
            isExplicitAuthorizationDenial(
              caught,
            )
          ) {
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
      [
        accessMode,
        completeCloudEntry,
        loadOffline,
      ],
    );

  useEffect(() => {
    reloadCoordinator.setTask(performReload);
  }, [performReload, reloadCoordinator]);
  const reload = useCallback(
    (organizationId?: string) => reloadCoordinator.run(organizationId),
    [reloadCoordinator],
  );

  useEffect(() => {
    const timer = setTimeout(
      () => void reload(),
      0,
    );

    return () =>
      clearTimeout(timer);
  }, [accessMode, reload]);

  useEffect(() => {
    let previousState = AppState.currentState;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (shouldReloadAfterAppStateChange(previousState, nextState)) {
        void reload(data?.core.organization.id);
      }
      previousState = nextState;
    });
    return () => subscription.remove();
  }, [data?.core.organization.id, reload]);

  const effectiveOfflineExpiresAt =
    preparedOfflineExpiresAt ?? sessionOfflineExpiresAt;
  const authorizationState = evaluateOfflineAuthorizationLifecycle({
    prepared: Boolean(effectiveOfflineExpiresAt),
    expiresAt: effectiveOfflineExpiresAt,
    restrictionReason: mode === "offline" ? offlineRestrictionReason : null,
    now: readinessCheckedAt,
  });
  const cashierReadinessState = deriveCashierReadinessState({
    connectionMode,
    authorizationState,
  });

  useEffect(() => {
    if (mode !== "offline") return;
    const now = Date.now();
    const current = evaluateOfflineAuthorizationLifecycle({
      prepared: Boolean(effectiveOfflineExpiresAt),
      expiresAt: effectiveOfflineExpiresAt,
      restrictionReason: offlineRestrictionReason,
      now,
    });
    const delay = nextOfflineAuthorizationCheckDelay({
      state: current,
      expiresAt: effectiveOfflineExpiresAt,
      now,
    });
    if (delay === null) return;

    const timer = setTimeout(() => {
      setReadinessCheckedAt((previous) => Math.max(previous, Date.now()));
      void refreshOfflineAccess();
    }, delay);
    return () => clearTimeout(timer);
  }, [
    effectiveOfflineExpiresAt,
    mode,
    offlineRestrictionReason,
    refreshOfflineAccess,
  ]);

  const value = useMemo(
    () => ({
      data,
      loading,
      error,
      mode,
      connectionMode,
      offlineExpiresAt: effectiveOfflineExpiresAt,
      cashierReadinessState,
      reload,
    }),
    [
      data,
      loading,
      error,
      mode,
      connectionMode,
      effectiveOfflineExpiresAt,
      cashierReadinessState,
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
