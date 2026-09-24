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
  Json,
} from "@/lib/supabase/database.types";

import {
  getPublicEnvironment,
} from "@/lib/supabase/env";

// This bridge keeps the new RPC typed until the packet-required local
// migration replay can regenerate Database. It must reconcile with the
// generated function signature before this work is certified.
type PosV2Database =
  Omit<Database, "public"> & {
    public:
      Omit<
        Database["public"],
        "Functions"
      > & {
        Functions:
          Database["public"]["Functions"] & {
            get_pos_bootstrap_core_v2: {
              Args: {
                target_organization_id?: string;
              };
              Returns: Json;
            };
          };
      };
  };

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

  return createSupabaseClient<PosV2Database>(
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
