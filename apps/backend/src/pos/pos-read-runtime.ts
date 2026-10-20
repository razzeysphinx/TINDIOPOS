import { createClient } from "@supabase/supabase-js";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";

export type PosReadEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};

type PosReadRuntimeOptions = {
  environment: PosReadEnvironment;
  fetchImpl?: typeof fetch;
};

export type PosReadRpcName =
  | "get_pos_bootstrap_core_v2"
  | "get_pos_reference_bundle_v2"
  | "get_pos_catalog_v2"
  | "get_pos_modifiers_v2";

export type PosReadRpcArguments = Record<
  string,
  string | number | undefined
>;

export type PosReadRpcResult = {
  data: unknown;
  error: unknown;
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

export function createPosReadRuntime({
  environment,
  fetchImpl = fetch,
}: PosReadRuntimeOptions) {
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
    verifyClaims: async (token: string) => authClient.auth.getClaims(token),
    callRpc: async (
      token: string,
      name: PosReadRpcName,
      args: PosReadRpcArguments,
    ): Promise<PosReadRpcResult> => {
      const database = createClient(
        supabaseUrl,
        publishableKey,
        {
          accessToken: async () => token,
          auth: {
            autoRefreshToken: false,
            detectSessionInUrl: false,
            persistSession: false,
          },
          global: {
            fetch: databaseFetch,
          },
        },
      );

      return database.rpc(name, args);
    },
  };
}
