import type { AuthSession } from "@tindio/contracts/auth";
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
import { fetchPosV2Core } from "../../lib/tindio-api";
import { mobileAuth } from "./auth-provider";
import {
  inspectMobileAuthTransition,
  recordVerifiedMobileAuthProvider,
  type MobileAuthTransitionState,
} from "./auth-transition";
import { secureStorage } from "../../lib/secure-storage";
import { SUPABASE_MOBILE_AUTH_STORAGE_KEY } from "../../lib/supabase";
import { NEON_MOBILE_AUTH_COOKIE_KEY } from "./auth-storage-keys";
import {
  clearOfflineAuthorizationGrant,
  offlineAuthorizationFailureMessage,
  readOfflineAuthorizationGrant,
} from "../offline/offline-authorization";
import {
  evaluateOfflineReadiness,
  evaluateOfflineScopeReadiness,
} from "../offline/offline-readiness";
import {
  evaluateOfflineAuthorizationLifecycle,
  type OfflineAuthorizationLifecycleState,
} from "../offline/cashier-readiness-policy";
import {
  canReleaseTransactionCustody,
} from "../offline/transaction-custody";

type Result =
  | { ok: true }
  | { ok: false; message: string };

export type AccessMode =
  | "online"
  | "offline"
  | "signed-out";

type Value = {
  session: AuthSession | null;
  loading: boolean;
  accessMode: AccessMode;
  offlineExpiresAt: string | null;
  offlineRestrictionReason: string | null;
  offlineAuthorizationState: OfflineAuthorizationLifecycleState;
  authTransitionState: MobileAuthTransitionState;
  signIn(
    email: string,
    password: string,
  ): Promise<Result>;
  reauthenticate(
    email: string,
    password: string,
    organizationId: string,
  ): Promise<Result>;
  signOut(): Promise<Result>;
  refreshOfflineAccess(): Promise<void>;
};

const Context = createContext<Value | null>(null);

function isUnexpired(session: AuthSession | null) {
  return Boolean(
    session
    && (
      !session.expiresAt
      || Date.parse(session.expiresAt) > Date.now()
    ),
  );
}

export function SessionProvider({
  children,
}: PropsWithChildren) {
  const [session, setSession] =
    useState<AuthSession | null>(null);
  const [loading, setLoading] =
    useState(true);
  const [accessMode, setAccessMode] =
    useState<AccessMode>("signed-out");
  const [offlineExpiresAt, setOfflineExpiresAt] =
    useState<string | null>(null);
  const [offlineRestrictionReason, setOfflineRestrictionReason] =
    useState<string | null>(null);
  const [offlineAuthorizationState, setOfflineAuthorizationState] =
    useState<OfflineAuthorizationLifecycleState>("PREPARATION_REQUIRED");
  const [authTransitionState, setAuthTransitionState] =
    useState<MobileAuthTransitionState>("SIGN_IN_REQUIRED");

  const refreshAuthTransition = useCallback(async () => {
    const snapshot = await inspectMobileAuthTransition({
      neonStorageKey: NEON_MOBILE_AUTH_COOKIE_KEY,
      storage: secureStorage,
      supabaseStorageKey: SUPABASE_MOBILE_AUTH_STORAGE_KEY,
      targetProvider: mobileAuth.provider,
    });
    setAuthTransitionState(snapshot.state);
  }, []);

  const applyOfflineReadiness =
    useCallback(async () => {
      const readiness =
        await evaluateOfflineReadiness();

      if (readiness.ok) {
        setAccessMode("offline");
        setOfflineExpiresAt(
          readiness.grant.expiresAt,
        );
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState(evaluateOfflineAuthorizationLifecycle({
          prepared: true,
          expiresAt: readiness.grant.expiresAt,
          restrictionReason: null,
          now: Date.now(),
        }));
        return;
      }

      const grant = await readOfflineAuthorizationGrant();
      const restricted = grant
        ? await evaluateOfflineScopeReadiness(grant)
        : null;
      const restrictionMessage = offlineAuthorizationFailureMessage(readiness.reason);

      if (grant && restricted?.ok) {
        setAccessMode("offline");
        setOfflineExpiresAt(grant.expiresAt);
        setOfflineRestrictionReason(restrictionMessage);
        setOfflineAuthorizationState("EXPIRED_RECONNECT_REQUIRED");
        return;
      }

      setAccessMode("signed-out");
      setOfflineExpiresAt(null);
      setOfflineRestrictionReason(restrictionMessage);
      setOfflineAuthorizationState("PREPARATION_REQUIRED");
    }, []);

  const refreshOfflineAccess =
    useCallback(async () => {
      await applyOfflineReadiness();
    }, [applyOfflineReadiness]);

  useEffect(() => {
    let active = true;

    const recoverSessionOnForeground = async () => {
      const current = await mobileAuth.getSession();
      let next = current.ok ? current.value : null;

      if (!isUnexpired(next)) {
        const refreshed = await mobileAuth.refreshSession();
        next = refreshed.ok ? refreshed.value : null;
      }

      if (!active) return;
      setSession(next);
      if (isUnexpired(next)) {
        setAccessMode("online");
        setOfflineExpiresAt(null);
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState("PREPARATION_REQUIRED");
      } else {
        await applyOfflineReadiness();
      }
    };

    const start = async () => {
      await refreshAuthTransition();
      const result =
        await mobileAuth.getSession();

      const next = result.ok
        ? result.value
        : null;

      if (!active) return;

      setSession(next);

      if (isUnexpired(next)) {
        setAccessMode("online");
        setOfflineExpiresAt(null);
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState("PREPARATION_REQUIRED");
      } else {
        await applyOfflineReadiness();
      }

      if (active) setLoading(false);
    };

    const timer = setTimeout(
      () => void start(),
      0,
    );

    const unsubscribe =
      mobileAuth.onAuthStateChange(
        (_event, next) => {
          setSession(next);

          if (isUnexpired(next)) {
            setAccessMode("online");
            setOfflineExpiresAt(null);
            setOfflineRestrictionReason(null);
            setOfflineAuthorizationState("PREPARATION_REQUIRED");
          } else {
            void applyOfflineReadiness();
          }

          void refreshAuthTransition();

          setLoading(false);
        },
      );

    const app = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          mobileAuth.startAutoRefresh();
          void recoverSessionOnForeground();
        } else {
          mobileAuth.stopAutoRefresh();
        }
      },
    );

    mobileAuth.startAutoRefresh();

    return () => {
      active = false;
      clearTimeout(timer);
      unsubscribe();
      app.remove();
      mobileAuth.stopAutoRefresh();
    };
  }, [applyOfflineReadiness, refreshAuthTransition]);

  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<Result> => {
      const result =
        await mobileAuth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (!result.ok) {
        return {
          ok: false,
          message:
            "Email or password is incorrect.",
        };
      }

      try {
        await fetchPosV2Core();
        await recordVerifiedMobileAuthProvider({
          provider: mobileAuth.provider,
          storage: secureStorage,
        });
        await refreshAuthTransition();
        setSession(result.value);
        setAccessMode("online");
        setOfflineExpiresAt(null);
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState("PREPARATION_REQUIRED");
        return { ok: true };
      } catch {
        await mobileAuth.signOut();

        return {
          ok: false,
          message:
            "This account could not open TINDIO POS.",
        };
      }
    },
    [refreshAuthTransition],
  );

  const signOut =
    useCallback(async (): Promise<Result> => {
      const custody =
        await canReleaseTransactionCustody();

      if (!custody.ok) {
        return {
          ok: false,
          message: custody.message,
        };
      }

      await clearOfflineAuthorizationGrant();
      await mobileAuth.signOut();
      await refreshAuthTransition();

      setSession(null);
      setAccessMode("signed-out");
      setOfflineExpiresAt(null);
      setOfflineRestrictionReason(null);
      setOfflineAuthorizationState("PREPARATION_REQUIRED");

      return { ok: true };
    }, [refreshAuthTransition]);

  const reauthenticate = useCallback(
    async (
      email: string,
      password: string,
      organizationId: string,
    ): Promise<Result> => {
      const result = await mobileAuth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (!result.ok) {
        return { ok: false, message: "Email or password is incorrect." };
      }

      try {
        const core = await fetchPosV2Core(organizationId);
        if (core.core.organization.id !== organizationId) {
          throw new Error("ORGANIZATION_MISMATCH");
        }
        await recordVerifiedMobileAuthProvider({
          provider: mobileAuth.provider,
          storage: secureStorage,
        });
        await refreshAuthTransition();
        setSession(result.value);
        setAccessMode("online");
        setOfflineExpiresAt(null);
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState("PREPARATION_REQUIRED");
        return { ok: true };
      } catch {
        await mobileAuth.signOut();
        await applyOfflineReadiness();
        return {
          ok: false,
          message: "This account is not authorized for the protected business. Local transactions remain saved.",
        };
      }
    },
    [applyOfflineReadiness, refreshAuthTransition],
  );

  const value = useMemo(
    () => ({
      session,
      loading,
      accessMode,
      offlineExpiresAt,
      offlineRestrictionReason,
      offlineAuthorizationState,
      authTransitionState,
      signIn,
      reauthenticate,
      signOut,
      refreshOfflineAccess,
    }),
    [
      session,
      loading,
      accessMode,
      offlineExpiresAt,
      offlineRestrictionReason,
      offlineAuthorizationState,
      authTransitionState,
      signIn,
      reauthenticate,
      signOut,
      refreshOfflineAccess,
    ],
  );

  return (
    <Context.Provider value={value}>
      {children}
    </Context.Provider>
  );
}

export function useSession() {
  const value = useContext(Context);

  if (!value) {
    throw new Error(
      "useSession must be used inside SessionProvider.",
    );
  }

  return value;
}
