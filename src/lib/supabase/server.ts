import "server-only";

import {
  createServerClient,
} from "@supabase/ssr";
import {
  cookies,
} from "next/headers";

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

export async function createClient(
  options: {
    headers?: Record<
      string,
      string
    >;
  } = {},
) {
  const environment =
    getPublicEnvironment();

  const databaseEnvironment =
    getDatabaseEnvironment();

  const cookieStore =
    await cookies();

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

  return createServerClient<
    Database
  >(
    environment
      .NEXT_PUBLIC_SUPABASE_URL,

    environment
      .NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,

    {
      cookies: {
        getAll() {
          return cookieStore
            .getAll();
        },

        setAll(
          cookiesToSet,
        ) {
          try {
            cookiesToSet
              .forEach(
                ({
                  name,
                  value,
                  options,
                }) => {
                  cookieStore
                    .set(
                      name,
                      value,
                      options,
                    );
                },
              );
          } catch {
            // Server Components cannot write cookies.
            // Proxy handles refreshes.
          }
        },
      },

      global: {
        ...(databaseFetch
          ? {
              fetch:
                databaseFetch,
            }
          : {}),

        ...(options.headers
          ? {
              headers:
                options.headers,
            }
          : {}),
      },
    },
  );
}
