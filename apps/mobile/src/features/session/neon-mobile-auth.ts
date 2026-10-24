import type {
  AuthFailure,
  AuthResult,
  AuthSession,
  AuthSessionAdapter,
  AuthStateEvent,
} from "@tindio/contracts/auth";

type AuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

type MobileNeonAuthAdapter = AuthSessionAdapter & {
  startAutoRefresh(): void;
  stopAutoRefresh(): void;
};

type BetterAuthSessionPayload = {
  session?: { expiresAt?: string };
  user?: { id?: string; email?: string; name?: string };
};

const COOKIE_STORAGE_KEY = "tindio.auth.neon.session-cookie.v1";
const REFRESH_INTERVAL_MS = 60_000;
const REFRESH_WINDOW_MS = 90_000;

function failure(
  code: AuthFailure["code"],
  message: string,
  status: number | null = null,
): AuthResult<never> {
  return { ok: false, error: { code, message, status } };
}

function parseCookies(value: string | null) {
  if (!value) return [];
  return value
    .split(/,(?=\s*[^;,=\s]+=[^;,]+)/)
    .map((cookie) => cookie.trim().split(";", 1)[0])
    .filter((cookie) => cookie.includes("="));
}

function mergeCookies(current: string | null, setCookie: string | null) {
  const jar = new Map<string, string>();
  for (const cookie of current?.split(/;\s*/) ?? []) {
    const separator = cookie.indexOf("=");
    if (separator > 0) jar.set(cookie.slice(0, separator), cookie);
  }
  for (const cookie of parseCookies(setCookie)) {
    const separator = cookie.indexOf("=");
    const name = cookie.slice(0, separator);
    const value = cookie.slice(separator + 1);
    if (value) jar.set(name, cookie);
    else jar.delete(name);
  }
  return [...jar.values()].join("; ");
}

function managedNeonAuthUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i.test(
        url.hostname,
      )
      && url.pathname.replace(/\/$/, "").endsWith("/auth")
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function localProofOrigin(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["localhost", "127.0.0.1"].includes(url.hostname)
      && url.pathname === "/"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

export function neonMobileProofEnabled(configuration: {
  provider: string | null | undefined;
  proofMode: string | null | undefined;
  baseUrl: string | null | undefined;
  origin: string | null | undefined;
  productionBuild: boolean;
}) {
  return configuration.provider === "neon"
    && configuration.proofMode === "local"
    && !configuration.productionBuild
    && Boolean(
      configuration.baseUrl
      && managedNeonAuthUrl(configuration.baseUrl),
    )
    && Boolean(configuration.origin && localProofOrigin(configuration.origin));
}

export function createNeonMobileAuth(options: {
  baseUrl: string;
  origin: string;
  storage: AuthStorage;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}): MobileNeonAuthAdapter {
  if (!managedNeonAuthUrl(options.baseUrl)) {
    throw new Error("The isolated Neon Mobile Auth proof is not enabled.");
  }
  if (!localProofOrigin(options.origin)) {
    throw new Error("The Neon Mobile Auth proof origin must be localhost.");
  }

  const baseUrl = options.baseUrl.replace(/\/$/, "");
  const requestFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const listeners = new Set<(
    event: AuthStateEvent,
    session: AuthSession | null,
  ) => void>();
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let refreshInFlight: Promise<AuthResult<AuthSession | null>> | null = null;

  const emit = (event: AuthStateEvent, session: AuthSession | null) => {
    for (const listener of listeners) listener(event, session);
  };

  const request = async (path: string, init: RequestInit = {}) => {
    const cookie = await options.storage.getItem(COOKIE_STORAGE_KEY);
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("Origin", options.origin);
    if (init.body) headers.set("Content-Type", "application/json");
    if (cookie) headers.set("Cookie", cookie);

    const response = await requestFetch(`${baseUrl}/${path}`, {
      ...init,
      headers,
    });
    const nextCookie = mergeCookies(
      cookie,
      response.headers.get("set-cookie"),
    );
    if (nextCookie) await options.storage.setItem(COOKIE_STORAGE_KEY, nextCookie);
    else if (cookie && response.headers.get("set-cookie")) {
      await options.storage.removeItem(COOKIE_STORAGE_KEY);
    }
    return response;
  };

  const sessionFromProvider = async (): Promise<AuthResult<AuthSession | null>> => {
    try {
      const response = await request("get-session");
      if (response.status === 401) {
        await options.storage.removeItem(COOKIE_STORAGE_KEY);
        return { ok: true, value: null };
      }
      if (!response.ok) {
        return failure(
          "PROVIDER_UNAVAILABLE",
          "Neon Auth could not restore the mobile session.",
          response.status,
        );
      }
      const payload = await response.json() as BetterAuthSessionPayload | null;
      if (!payload?.user?.id) return { ok: true, value: null };

      const tokenResponse = await request("token");
      if (!tokenResponse.ok) {
        return failure(
          "INVALID_SESSION",
          "Neon Auth could not issue a bearer token.",
          tokenResponse.status,
        );
      }
      const tokenPayload = await tokenResponse.json() as {
        token?: string;
        access_token?: string;
      };
      const accessToken = tokenPayload.token ?? tokenPayload.access_token;
      if (!accessToken || accessToken.split(".").length !== 3) {
        return failure("INVALID_TOKEN", "Neon Auth returned an invalid bearer token.");
      }

      return {
        ok: true,
        value: {
          provider: "neon",
          accessToken,
          expiresAt: payload.session?.expiresAt ?? null,
          identity: {
            subject: payload.user.id,
            email: payload.user.email ?? null,
            displayName: payload.user.name?.trim() || null,
          },
        },
      };
    } catch (error) {
      return failure(
        "PROVIDER_UNAVAILABLE",
        error instanceof Error
          ? error.message
          : "Neon Auth could not complete the mobile request.",
      );
    }
  };

  const refreshOnce = () => {
    if (!refreshInFlight) {
      refreshInFlight = sessionFromProvider().finally(() => {
        refreshInFlight = null;
      });
    }
    return refreshInFlight;
  };

  return {
    provider: "neon",

    getSession: sessionFromProvider,

    async refreshSession() {
      const result = await refreshOnce();
      if (result.ok) emit("TOKEN_REFRESHED", result.value);
      return result;
    },

    async signInWithPassword(credentials) {
      try {
        const response = await request("sign-in/email", {
          method: "POST",
          body: JSON.stringify(credentials),
        });
        if (!response.ok) {
          return failure(
            response.status === 401 || response.status === 400
              ? "INVALID_CREDENTIALS"
              : "PROVIDER_UNAVAILABLE",
            "Neon Auth rejected the mobile sign-in.",
            response.status,
          );
        }
        const result = await sessionFromProvider();
        if (!result.ok || !result.value) {
          return result.ok
            ? failure("INVALID_SESSION", "Neon Auth returned no mobile session.")
            : result;
        }
        emit("SIGNED_IN", result.value);
        return { ok: true, value: result.value };
      } catch (error) {
        return failure(
          "PROVIDER_UNAVAILABLE",
          error instanceof Error ? error.message : "Neon Auth sign-in failed.",
        );
      }
    },

    async signOut() {
      try {
        const response = await request("sign-out", {
          method: "POST",
          body: "{}",
        });
        if (!response.ok && response.status !== 401) {
          return failure(
            "PROVIDER_UNAVAILABLE",
            "Neon Auth could not close the mobile session.",
            response.status,
          );
        }
        await options.storage.removeItem(COOKIE_STORAGE_KEY);
        emit("SIGNED_OUT", null);
        return { ok: true, value: null };
      } catch (error) {
        return failure(
          "PROVIDER_UNAVAILABLE",
          error instanceof Error ? error.message : "Neon Auth sign-out failed.",
        );
      }
    },

    onAuthStateChange(listener) {
      listeners.add(listener);
      void sessionFromProvider().then((result) => {
        if (listeners.has(listener)) {
          listener("INITIAL_SESSION", result.ok ? result.value : null);
        }
      });
      return () => listeners.delete(listener);
    },

    startAutoRefresh() {
      if (refreshTimer) return;
      refreshTimer = setInterval(() => {
        void sessionFromProvider().then((result) => {
          if (
            result.ok
            && result.value?.expiresAt
            && Date.parse(result.value.expiresAt) - now() <= REFRESH_WINDOW_MS
          ) {
            void refreshOnce().then((refreshed) => {
              if (refreshed.ok) emit("TOKEN_REFRESHED", refreshed.value);
            });
          }
        });
      }, REFRESH_INTERVAL_MS);
    },

    stopAutoRefresh() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = null;
    },
  };
}

export const NEON_MOBILE_AUTH_COOKIE_KEY = COOKIE_STORAGE_KEY;
