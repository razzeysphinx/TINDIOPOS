import { createClient } from "@supabase/supabase-js";
import {
  resolveTindioAuthProvider,
  type AuthFailure,
  type AuthResult,
  type AuthTokenVerifier,
  type AuthVerifiedClaims,
  type TindioAuthProvider,
} from "@tindio/contracts/auth";

export type BackendAuthEnvironment = {
  TINDIO_AUTH_PROVIDER?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
};

function requiredHttpUrl(
  name: string,
  value: string | undefined,
): string {
  if (!value) throw new Error(`${name} is required`);

  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.username
    || url.password
  ) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }

  return url.toString();
}

function stringClaim(
  claims: Record<string, unknown>,
  key: string,
): string | null {
  const value = claims[key];
  return typeof value === "string" && value.length > 0
    ? value
    : null;
}

function expiresAt(
  claims: Record<string, unknown>,
): string | null {
  const value = claims.exp;
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value * 1_000).toISOString()
    : null;
}

function authFailure(error: unknown): AuthFailure {
  const status =
    error
    && typeof error === "object"
    && "status" in error
    && typeof error.status === "number"
      ? error.status
      : null;

  return {
    code:
      status !== null && status >= 400 && status < 500
        ? "INVALID_TOKEN"
        : "PROVIDER_UNAVAILABLE",
    message:
      error instanceof Error
        ? error.message
        : "The authentication provider could not verify the token.",
    status,
  };
}

export function resolveBackendAuthProvider(
  configuredProvider: string | null | undefined,
): TindioAuthProvider {
  return resolveTindioAuthProvider(configuredProvider, ["supabase"]);
}

export function createBackendAuthTokenVerifier({
  environment,
  fetchImpl = fetch,
}: {
  environment: BackendAuthEnvironment;
  fetchImpl?: typeof fetch;
}): AuthTokenVerifier {
  const provider = resolveBackendAuthProvider(
    environment.TINDIO_AUTH_PROVIDER,
  );
  const url = requiredHttpUrl(
    "SUPABASE_URL",
    environment.SUPABASE_URL,
  );
  const key = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");

  const client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { fetch: fetchImpl },
  });

  return {
    provider,
    async verifyAccessToken(
      token: string,
    ): Promise<AuthResult<AuthVerifiedClaims>> {
      const { data, error } = await client.auth.getClaims(token);
      const claims = data?.claims as Record<string, unknown> | undefined;
      const subject = claims ? stringClaim(claims, "sub") : null;

      if (error || !claims || !subject) {
        return {
          ok: false,
          error: authFailure(
            error ?? new Error("The token has no authenticated subject."),
          ),
        };
      }

      return {
        ok: true,
        value: {
          provider,
          subject,
          email: stringClaim(claims, "email"),
          role: stringClaim(claims, "role"),
          sessionId: stringClaim(claims, "session_id"),
          expiresAt: expiresAt(claims),
          raw: claims,
        },
      };
    },
  };
}
