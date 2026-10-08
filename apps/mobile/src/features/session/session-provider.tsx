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
} from "../offline/offline-authorization";
import {
  evaluateOfflineReadiness,
} from "../offline/offline-readiness";
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
        return;
      }

      setAccessMode("signed-out");
      setOfflineExpiresAt(null);
      setOfflineRestrictionReason(
        offlineAuthorizationFailureMessage(readiness.reason),
      );
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
