export type DatabaseProvider =
  "supabase"
  | "neon";

function isHostedDeployment(
  environment: NodeJS.ProcessEnv,
) {
  return environment.VERCEL === "1"
    || environment.VERCEL_ENV === "preview"
    || environment.VERCEL_ENV === "production";
}

export function resolveDatabaseProvider(
  environment: NodeJS.ProcessEnv,
): DatabaseProvider {
  const configuredProvider =
    environment.TINDIO_DATABASE_PROVIDER;

  if (isHostedDeployment(environment) && !configuredProvider) {
    throw new Error(
      "Hosted TINDIO deployments require an explicit TINDIO_DATABASE_PROVIDER.",
    );
  }

  const provider = configuredProvider ?? "supabase";

  if (environment.VERCEL_ENV === "production" && provider !== "neon") {
    throw new Error(
      "Production TINDIO deployments must use the Neon database provider.",
    );
  }

  if (provider !== "supabase" && provider !== "neon") {
    throw new Error("TINDIO database provider configuration is invalid.");
  }

  if (provider === "neon") {
    try {
      new URL(environment.NEON_DATA_API_URL ?? "");
    } catch {
      throw new Error(
        "Neon database mode requires a valid server-side NEON_DATA_API_URL.",
      );
    }
  }

  return provider;
}
