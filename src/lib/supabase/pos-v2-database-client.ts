import "server-only";

import {
  createClient as createSupabaseClient,
} from "@supabase/supabase-js";

import {
  getDatabaseEnvironment,
} from "@/lib/database/env";

import {
  createNeonDataApiFetch,
} from "@/lib/database/neon-data-api-fetch";

import type {
  Database,
} from "@/lib/supabase/database.types";

import {
  getPublicEnvironment,
} from "@/lib/supabase/env";

export function createPosV2DatabaseClient(
  accessToken: string,
) {
  const environment =
    getPublicEnvironment();

  const databaseEnvironment =
    getDatabaseEnvironment();

  const databaseFetch =
    databaseEnvironment.TINDIO_DATABASE_PROVIDER === "neon"
      ? createNeonDataApiFetch({
          supabaseUrl:
            environment.NEXT_PUBLIC_SUPABASE_URL,
          neonDataApiUrl:
            databaseEnvironment.NEON_DATA_API_URL,
        })
      : undefined;

  return createSupabaseClient<Database>(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      accessToken:
        async () =>
          accessToken,

      global: {
        ...(databaseFetch
          ? { fetch: databaseFetch }
          : {}),
      },
    },
  );
}
