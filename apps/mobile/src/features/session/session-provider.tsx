import type { Session } from "@supabase/supabase-js";
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
import { supabase } from "../../lib/supabase";
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
  session: Session | null;
  loading: boolean;
  accessMode: AccessMode;
  offlineExpiresAt: string | null;
  offlineRestrictionReason: string | null;
  offlineAuthorizationState: OfflineAuthorizationLifecycleState;
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

function isUnexpired(session: Session | null) {
  return Boolean(
    session
    && (
      !session.expires_at
      || session.expires_at * 1000 > Date.now()
    ),
  );
}

export function SessionProvider({
  children,
}: PropsWithChildren) {
  const [session, setSession] =
    useState<Session | null>(null);
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
      const current = await supabase.auth.getSession();
      let next = current.data.session;

      if (!isUnexpired(next)) {
        const refreshed = await supabase.auth.refreshSession();
        next = refreshed.error ? null : refreshed.data.session;
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
      const { data } =
        await supabase.auth.getSession();

      if (!active) return;

      setSession(data.session);

      if (isUnexpired(data.session)) {
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

    const auth =
      supabase.auth.onAuthStateChange(
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

          setLoading(false);
        },
      ).data.subscription;

    const app = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          supabase.auth.startAutoRefresh();
          void recoverSessionOnForeground();
        } else {
          supabase.auth.stopAutoRefresh();
        }
      },
    );

    supabase.auth.startAutoRefresh();

    return () => {
      active = false;
      clearTimeout(timer);
      auth.unsubscribe();
      app.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, [applyOfflineReadiness]);

  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<Result> => {
      const result =
        await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (
        result.error
        || !result.data.session
      ) {
        return {
          ok: false,
          message:
            "Email or password is incorrect.",
        };
      }

      try {
        await fetchPosV2Core();
        setSession(result.data.session);
        setAccessMode("online");
        setOfflineExpiresAt(null);
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState("PREPARATION_REQUIRED");
        return { ok: true };
      } catch {
        await supabase.auth.signOut();

        return {
          ok: false,
          message:
            "This account could not open TINDIO POS.",
        };
      }
    },
    [],
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
      await supabase.auth.signOut();

      setSession(null);
      setAccessMode("signed-out");
      setOfflineExpiresAt(null);
      setOfflineRestrictionReason(null);
      setOfflineAuthorizationState("PREPARATION_REQUIRED");

      return { ok: true };
    }, []);

  const reauthenticate = useCallback(
    async (
      email: string,
      password: string,
      organizationId: string,
    ): Promise<Result> => {
      const result = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (result.error || !result.data.session) {
        return { ok: false, message: "Email or password is incorrect." };
      }

      try {
        const core = await fetchPosV2Core(organizationId);
        if (core.core.organization.id !== organizationId) {
          throw new Error("ORGANIZATION_MISMATCH");
        }
        setSession(result.data.session);
        setAccessMode("online");
        setOfflineExpiresAt(null);
        setOfflineRestrictionReason(null);
        setOfflineAuthorizationState("PREPARATION_REQUIRED");
        return { ok: true };
      } catch {
        await supabase.auth.signOut();
        await applyOfflineReadiness();
        return {
          ok: false,
          message: "This account is not authorized for the protected business. Local transactions remain saved.",
        };
      }
    },
    [applyOfflineReadiness],
  );

  const value = useMemo(
    () => ({
      session,
      loading,
      accessMode,
      offlineExpiresAt,
      offlineRestrictionReason,
      offlineAuthorizationState,
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
