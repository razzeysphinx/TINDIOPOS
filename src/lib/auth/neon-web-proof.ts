import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

import { resolveWebAuthProvider } from "@/lib/auth/provider";

const SYNTHETIC_EMAIL_SUFFIX = "@auth-proof.tindio.invalid";

export class NeonWebProofConfigurationError extends Error {
  readonly code = "NEON_WEB_PROOF_NOT_ENABLED";

  constructor() {
    super("The isolated Neon Web Auth proof is not enabled for this runtime.");
    this.name = "NeonWebProofConfigurationError";
  }
}

export function isSyntheticNeonProofEmail(email: string) {
  return email.trim().toLowerCase().endsWith(SYNTHETIC_EMAIL_SUFFIX);
}

export function getNeonWebProofConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const baseUrl = environment.NEON_AUTH_BASE_URL?.trim();
  const cookieSecret = environment.NEON_AUTH_COOKIE_SECRET?.trim();
  const sessionDataTtl = Number(
    environment.TINDIO_AUTH_PROOF_SESSION_DATA_TTL ?? "1",
  );

  try {
    const provider = resolveWebAuthProvider(
      environment.TINDIO_AUTH_PROVIDER,
      {
        mode: environment.TINDIO_AUTH_PROOF_MODE,
        nodeEnvironment: environment.NODE_ENV,
        deploymentEnvironment:
          environment.VERCEL_ENV
          ?? environment.VERCEL,
        neonAuthBaseUrl: baseUrl,
      },
    );

    if (
      provider !== "neon"
      || !baseUrl
      || !cookieSecret
      || cookieSecret.length < 32
      || !Number.isInteger(sessionDataTtl)
      || sessionDataTtl < 1
      || sessionDataTtl > 60
    ) {
      throw new NeonWebProofConfigurationError();
    }
  } catch (error) {
    if (error instanceof NeonWebProofConfigurationError) throw error;
    throw new NeonWebProofConfigurationError();
  }

  return {
    baseUrl,
    cookieSecret,
    sessionDataTtl,
    syntheticEmailSuffix: SYNTHETIC_EMAIL_SUFFIX,
  } as const;
}

export function getNeonWebProofOrigin(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const rawOrigin = environment.TINDIO_AUTH_PROOF_ORIGIN?.trim();

  try {
    if (!rawOrigin) throw new NeonWebProofConfigurationError();
    const origin = new URL(rawOrigin);
    if (
      origin.protocol !== "http:"
      || !["localhost", "127.0.0.1"].includes(origin.hostname)
      || origin.username
      || origin.password
      || origin.pathname !== "/"
      || origin.search
      || origin.hash
    ) {
      throw new NeonWebProofConfigurationError();
    }
    return origin.origin;
  } catch (error) {
    if (error instanceof NeonWebProofConfigurationError) throw error;
    throw new NeonWebProofConfigurationError();
  }
}

export function createNeonWebProofAuth(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = getNeonWebProofConfiguration(environment);

  return createNeonAuth({
    baseUrl: configuration.baseUrl,
    cookies: {
      secret: configuration.cookieSecret,
      sameSite: "strict",
      sessionDataTtl: configuration.sessionDataTtl,
    },
    logLevel: "warn",
  });
}
