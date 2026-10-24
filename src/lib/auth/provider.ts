import {
  resolveTindioAuthProvider,
  type TindioAuthProvider,
} from "@tindio/contracts/auth";

export function resolveWebAuthProvider(
  configuredProvider: string | null | undefined,
  proof?: {
    mode: string | null | undefined;
    nodeEnvironment: string | null | undefined;
    deploymentEnvironment: string | null | undefined;
    neonAuthBaseUrl: string | null | undefined;
  },
): TindioAuthProvider {
  const neonProofEnabled =
    proof?.mode === "local"
    && proof.nodeEnvironment !== "production"
    && !proof.deploymentEnvironment
    && isManagedNeonAuthUrl(proof.neonAuthBaseUrl);

  return resolveTindioAuthProvider(
    configuredProvider,
    neonProofEnabled ? ["supabase", "neon"] : ["supabase"],
  );
}

export function isManagedNeonAuthUrl(
  value: string | null | undefined,
) {
  if (!value) return false;

  try {
    const url = new URL(value);

    return url.protocol === "https:"
      && /^[a-z0-9-]+\.neonauth(?:\.[a-z0-9-]+)*\.neon\.tech$/i.test(
        url.hostname,
      )
      && url.pathname.endsWith("/auth")
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}
