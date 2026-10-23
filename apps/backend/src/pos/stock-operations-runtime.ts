import { createClient } from "@supabase/supabase-js";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import {
  STOCK_OPERATION_RPCS,
  stockOperationRpcArguments,
  type OwnedStockOperationsDependencies,
} from "./stock-operations-owned.js";

export type StockOperationsEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: StockOperationsEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  return url.toString();
}

export function createOwnedStockOperationsDependencies({ environment, fetchImpl = fetch }: RuntimeOptions): OwnedStockOperationsDependencies {
  const supabaseUrl = requiredHttpUrl("SUPABASE_URL", environment.SUPABASE_URL);
  const neonDataApiUrl = requiredHttpUrl("NEON_DATA_API_URL", environment.NEON_DATA_API_URL);
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");
  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: fetchImpl },
  });
  const databaseFetch = createNeonDataApiFetch({ supabaseUrl, neonDataApiUrl, fetchImpl });
  const database = (token: string) => createClient(supabaseUrl, publishableKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: databaseFetch },
  });
  return {
    verifyClaims: async (token) => auth.auth.getClaims(token),
    loadCore: async (token, organizationId) => database(token).rpc("get_pos_bootstrap_core_v2", organizationId ? { target_organization_id: organizationId } : {}),
    validateCart: async (token, organizationId, input) => database(token).rpc(STOCK_OPERATION_RPCS.validateCart, stockOperationRpcArguments.validateCart(organizationId, input)),
    receiveRequest: async (token, organizationId, input) => database(token).rpc(STOCK_OPERATION_RPCS.receiveRequest, stockOperationRpcArguments.receiveRequest(organizationId, input)),
  };
}
