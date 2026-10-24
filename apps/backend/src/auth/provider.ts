import { createClient } from "@supabase/supabase-js";
import {
  resolveTindioAuthProvider,
  type AuthFailure,
  type AuthResult,
  type AuthTokenVerifier,
  type AuthVerifiedClaims,
  type TindioAuthProvider,
} from "@tindio/contracts/auth";
import { createRemoteJWKSet, jwtVerify } from "jose";

export type BackendAuthEnvironment = {
  TINDIO_AUTH_PROVIDER?: string;
  TINDIO_AUTH_PROOF_MODE?: string;
  NODE_ENV?: string;
  VERCEL?: string;
  VERCEL_ENV?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_AUTH_BASE_URL?: string;
  NEON_AUTH_JWKS_URL?: string;
};

type NeonTokenVerification = (
  token: string,
) => Promise<Record<string, unknown>>;

const neonRemoteKeySets = new Map<
  string,
  ReturnType<typeof createRemoteJWKSet>
>();

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

function neonAuthFailure(error: unknown): AuthFailure {
  const code =
    error
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
      ? error.code
      : null;
  const providerUnavailable =
    code === "ERR_JWKS_TIMEOUT"
    || code === "ERR_JWKS_MULTIPLE_MATCHING_KEYS"
    || error instanceof TypeError;

  return {
    code: providerUnavailable
      ? "PROVIDER_UNAVAILABLE"
      : "INVALID_TOKEN",
    message: providerUnavailable
      ? "The Neon authentication keys are unavailable."
      : "The Neon access token is invalid.",
    status: providerUnavailable ? null : 401,
  };
}

function managedNeonAuthConfiguration(
  environment: BackendAuthEnvironment,
) {
  const baseUrl = environment.NEON_AUTH_BASE_URL?.trim();
  const jwksUrl = environment.NEON_AUTH_JWKS_URL?.trim();

  if (!baseUrl || !jwksUrl) return null;

  try {
    const base = new URL(baseUrl);
    const jwks = new URL(jwksUrl);
    const managedHost =
      /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i;
    const normalizedBasePath = base.pathname.replace(/\/$/, "");

    if (
      base.protocol !== "https:"
      || !managedHost.test(base.hostname)
      || !normalizedBasePath.endsWith("/auth")
      || base.username
      || base.password
      || base.search
      || base.hash
      || jwks.protocol !== "https:"
      || jwks.origin !== base.origin
      || jwks.pathname
        !== `${normalizedBasePath}/.well-known/jwks.json`
      || jwks.username
      || jwks.password
      || jwks.search
      || jwks.hash
    ) {
      return null;
    }

    return {
      baseUrl: base.toString(),
      issuer: base.origin,
      jwksUrl: jwks.toString(),
    } as const;
  } catch {
    return null;
  }
}

function neonProofEnabled(environment: BackendAuthEnvironment) {
  return environment.TINDIO_AUTH_PROOF_MODE === "local"
    && environment.NODE_ENV !== "production"
    && !environment.VERCEL
    && !environment.VERCEL_ENV
    && managedNeonAuthConfiguration(environment) !== null;
}

export function resolveBackendAuthProvider(
  configuredProvider: string | null | undefined,
  environment: BackendAuthEnvironment = {},
): TindioAuthProvider {
  return resolveTindioAuthProvider(
    configuredProvider,
    neonProofEnabled(environment)
      ? ["supabase", "neon"]
      : ["supabase"],
  );
}

export function createBackendAuthTokenVerifier({
  environment,
  fetchImpl = fetch,
  verifyNeonToken,
}: {
  environment: BackendAuthEnvironment;
  fetchImpl?: typeof fetch;
  verifyNeonToken?: NeonTokenVerification;
}): AuthTokenVerifier {
  const provider = resolveBackendAuthProvider(
    environment.TINDIO_AUTH_PROVIDER,
    environment,
  );

  if (provider === "neon") {
    const configuration = managedNeonAuthConfiguration(environment);
    if (!configuration) {
      throw new Error("Managed Neon Auth proof configuration is required");
    }
    const keySet = neonRemoteKeySets.get(configuration.jwksUrl)
      ?? createRemoteJWKSet(new URL(configuration.jwksUrl));
    neonRemoteKeySets.set(configuration.jwksUrl, keySet);
    const verify = verifyNeonToken ?? (async (token: string) => {
      const { payload } = await jwtVerify(token, keySet, {
        algorithms: ["EdDSA"],
        issuer: configuration.issuer,
      });
      return payload as Record<string, unknown>;
    });

    return {
      provider,
      async verifyAccessToken(
        token: string,
      ): Promise<AuthResult<AuthVerifiedClaims>> {
        try {
          const claims = await verify(token);
          const subject = stringClaim(claims, "sub");
          const role = stringClaim(claims, "role");

          if (!subject || role !== "authenticated") {
            return {
              ok: false,
              error: neonAuthFailure(
                new Error("The token has no authenticated subject."),
              ),
            };
          }

          return {
            ok: true,
            value: {
              provider,
              subject,
              email: stringClaim(claims, "email"),
              role,
              sessionId:
                stringClaim(claims, "session_id")
                ?? stringClaim(claims, "sid"),
              expiresAt: expiresAt(claims),
              raw: claims,
            },
          };
        } catch (error) {
          return { ok: false, error: neonAuthFailure(error) };
        }
      },
    };
  }

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
