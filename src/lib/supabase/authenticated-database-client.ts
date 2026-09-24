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

const MAX_BEARER_TOKEN_LENGTH =
  16_384;

function parseVerifiedBearer(
  authorizationHeader: string,
) {
  const match =
    /^Bearer ([^\s]+)$/i.exec(
      authorizationHeader.trim(),
    );

  const token =
    match?.[1];

  if (
    !token
    || token.length
      > MAX_BEARER_TOKEN_LENGTH
    || token.split(".").length
      !== 3
  ) {
    throw new Error(
      "A verified bearer token is required for authenticated database access.",
    );
  }

  return token;
}

export function createAuthenticatedDatabaseClient(
  authorizationHeader: string,
  options: {
    headers?: Record<
      string,
      string
    >;
  } = {},
) {
  const token =
    parseVerifiedBearer(
      authorizationHeader,
    );

  const environment =
    getPublicEnvironment();

  const databaseEnvironment =
    getDatabaseEnvironment();

  const databaseFetch =
    databaseEnvironment
      .TINDIO_DATABASE_PROVIDER
      === "neon"
      ? createNeonDataApiFetch({
          supabaseUrl:
            environment
              .NEXT_PUBLIC_SUPABASE_URL,

          neonDataApiUrl:
            databaseEnvironment
              .NEON_DATA_API_URL,
        })
      : undefined;

  const safeHeaders =
    Object.fromEntries(
      Object.entries(
        options.headers
        ?? {},
      ).filter(
        ([name]) => {
          const normalized =
            name.toLowerCase();

          return normalized
            !== "authorization"
            && normalized
              !== "apikey";
        },
      ),
    );

  return createSupabaseClient<
    Database
  >(
    environment
      .NEXT_PUBLIC_SUPABASE_URL,

    environment
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,

    {
      accessToken:
        async () =>
          token,

      global: {
        ...(databaseFetch
          ? {
              fetch:
                databaseFetch,
            }
          : {}),

        ...(Object.keys(
          safeHeaders,
        ).length > 0
          ? {
              headers:
                safeHeaders,
            }
          : {}),
      },
    },
  );
}
