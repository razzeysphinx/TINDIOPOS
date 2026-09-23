import "server-only";

import {
  z,
} from "zod";

const supabaseDatabaseEnvironmentSchema =
  z.object({
    TINDIO_DATABASE_PROVIDER:
      z.literal(
        "supabase",
      ),
  });

const neonDatabaseEnvironmentSchema =
  z.object({
    TINDIO_DATABASE_PROVIDER:
      z.literal(
        "neon",
      ),

    NEON_DATA_API_URL:
      z.url(),
  });

const databaseEnvironmentSchema =
  z.discriminatedUnion(
    "TINDIO_DATABASE_PROVIDER",
    [
      supabaseDatabaseEnvironmentSchema,
      neonDatabaseEnvironmentSchema,
    ],
  );

export type DatabaseEnvironment =
  z.infer<
    typeof databaseEnvironmentSchema
  >;

export function getDatabaseEnvironment():
  DatabaseEnvironment {
  const provider =
    process.env
      .TINDIO_DATABASE_PROVIDER
    ?? "supabase";

  const result =
    databaseEnvironmentSchema
      .safeParse({
        TINDIO_DATABASE_PROVIDER:
          provider,

        NEON_DATA_API_URL:
          process.env
            .NEON_DATA_API_URL,
      });

  if (!result.success) {
    throw new Error(
      provider === "neon"
        ? "Neon database mode requires a valid server-side NEON_DATA_API_URL."
        : "TINDIO database provider configuration is invalid.",
    );
  }

  return result.data;
}
