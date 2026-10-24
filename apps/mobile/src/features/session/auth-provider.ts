import type { Session } from "@supabase/supabase-js";
import {
  resolveTindioAuthProvider,
  type AuthFailure,
  type AuthResult,
  type AuthSession,
  type AuthSessionAdapter,
  type AuthStateEvent,
} from "@tindio/contracts/auth";

import { mobileEnvironment } from "../../lib/env";
import { supabase } from "../../lib/supabase";

type MobileAuthSessionAdapter = AuthSessionAdapter & {
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
};

function displayName(session: Session): string | null {
  const value = session.user.user_metadata?.full_name;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeSession(session: Session): AuthSession {
  return {
    provider: "supabase",
    accessToken: session.access_token,
    expiresAt:
      typeof session.expires_at === "number"
        ? new Date(session.expires_at * 1_000).toISOString()
        : null,
    identity: {
      subject: session.user.id,
      email: session.user.email ?? null,
      displayName: displayName(session),
    },
  };
}

function failure(
  error: unknown,
  code: AuthFailure["code"],
): AuthResult<never> {
  const status =
    error
    && typeof error === "object"
    && "status" in error
    && typeof error.status === "number"
      ? error.status
      : null;

  return {
    ok: false,
    error: {
      code,
      message:
        error instanceof Error
          ? error.message
          : "The authentication provider could not complete the request.",
      status,
    },
  };
}

function event(value: string): AuthStateEvent {
  switch (value) {
    case "INITIAL_SESSION":
    case "SIGNED_IN":
    case "SIGNED_OUT":
    case "TOKEN_REFRESHED":
    case "USER_UPDATED":
    case "PASSWORD_RECOVERY":
    case "MFA_CHALLENGE_VERIFIED":
      return value;
    default:
      return "UNKNOWN";
  }
}

const provider = resolveTindioAuthProvider(
  mobileEnvironment.authProvider,
  ["supabase"],
);

export const mobileAuth: MobileAuthSessionAdapter = {
  provider,

  async getSession() {
    const result = await supabase.auth.getSession();
    if (result.error) return failure(result.error, "INVALID_SESSION");
    return {
      ok: true,
      value: result.data.session
        ? normalizeSession(result.data.session)
        : null,
    };
  },

  async refreshSession() {
    const result = await supabase.auth.refreshSession();
    if (result.error) return failure(result.error, "INVALID_SESSION");
    return {
      ok: true,
      value: result.data.session
        ? normalizeSession(result.data.session)
        : null,
    };
  },

  async signInWithPassword(credentials) {
    const result = await supabase.auth.signInWithPassword(credentials);
    if (result.error || !result.data.session) {
      return failure(
        result.error ?? new Error("The provider returned no session."),
        "INVALID_CREDENTIALS",
      );
    }
    return { ok: true, value: normalizeSession(result.data.session) };
  },

  async signOut() {
    const result = await supabase.auth.signOut();
    if (result.error) return failure(result.error, "PROVIDER_UNAVAILABLE");
    return { ok: true, value: null };
  },

  onAuthStateChange(listener) {
    const subscription = supabase.auth.onAuthStateChange(
      (nextEvent, session) => listener(
        event(nextEvent),
        session ? normalizeSession(session) : null,
      ),
    ).data.subscription;

    return () => subscription.unsubscribe();
  },

  startAutoRefresh() {
    supabase.auth.startAutoRefresh();
  },

  stopAutoRefresh() {
    supabase.auth.stopAutoRefresh();
  },
};
