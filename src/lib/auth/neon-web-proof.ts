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
    syntheticEmailSuffix: SYNTHETIC_EMAIL_SUFFIX,
  } as const;
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
      // Keep the proof cache at the SDK's minimum positive TTL so revocation
      // is revalidated within one bounded second.
      sessionDataTtl: 1,
    },
    logLevel: "warn",
  });
}
