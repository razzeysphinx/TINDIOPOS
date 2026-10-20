import { createClient } from "@supabase/supabase-js";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import type { OwnedBootstrapDependencies } from "./bootstrap-owned.js";

type BootstrapEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};

type RuntimeOptions = {
  environment: BootstrapEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is required`);
  }

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

export function createOwnedBootstrapDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedBootstrapDependencies {
  const supabaseUrl = requiredHttpUrl("SUPABASE_URL", environment.SUPABASE_URL);
  const neonDataApiUrl = requiredHttpUrl(
    "NEON_DATA_API_URL",
    environment.NEON_DATA_API_URL,
  );
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error("SUPABASE_PUBLISHABLE_KEY is required");
  }

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      fetch: fetchImpl,
    },
  });

  const databaseFetch = createNeonDataApiFetch({
    supabaseUrl,
    neonDataApiUrl,
    fetchImpl,
  });

  return {
    createRequestId,
    verifyClaims: async (token) => authClient.auth.getClaims(token),
    loadCore: async (token, organizationId) => {
      const database = createClient(supabaseUrl, publishableKey, {
        accessToken: async () => token,
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
        global: {
          fetch: databaseFetch,
        },
      });

      return database.rpc(
        "get_pos_bootstrap_core_v2",
        organizationId
          ? { target_organization_id: organizationId }
          : {},
      );
    },
  };
}
