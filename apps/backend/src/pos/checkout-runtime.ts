import { createClient } from "@supabase/supabase-js";
import {
  POS_CHECKOUT_RPC,
  POS_CHECKOUT_STOCK_WARNING_RPC,
} from "@tindio/contracts/checkout";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import { toCheckoutRpcArguments } from "./checkout-compatibility.js";
import type { OwnedCheckoutDependencies } from "./checkout-owned.js";

export type CheckoutEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: CheckoutEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedCheckoutDependencies({
  environment,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedCheckoutDependencies {
  const supabaseUrl = requiredHttpUrl("SUPABASE_URL", environment.SUPABASE_URL);
  const neonDataApiUrl = requiredHttpUrl("NEON_DATA_API_URL", environment.NEON_DATA_API_URL);
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: fetchImpl },
  });
  const databaseFetch = createNeonDataApiFetch({ supabaseUrl, neonDataApiUrl, fetchImpl });
  const createDatabaseClient = (token: string, headers?: Record<string, string>) =>
    createClient(supabaseUrl, publishableKey, {
      accessToken: async () => token,
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: { fetch: databaseFetch, headers },
    });

  return {
    verifyClaims: async (token) => authClient.auth.getClaims(token),
    loadCore: async (token, organizationId) => createDatabaseClient(token).rpc(
      "get_pos_bootstrap_core_v2",
      organizationId ? { target_organization_id: organizationId } : {},
    ),
    checkout: async (token, organizationId, input, device) => createDatabaseClient(
      token,
      device ? {
        "x-tindio-device-id": device.deviceId,
        "x-tindio-device-secret": device.secret,
        "x-tindio-app-version": device.appVersion,
      } : undefined,
    ).rpc(POS_CHECKOUT_RPC, toCheckoutRpcArguments(organizationId, input)),
    loadStockWarning: async (token, organizationId, storeId, saleId) =>
      createDatabaseClient(token).rpc(POS_CHECKOUT_STOCK_WARNING_RPC, {
        target_organization_id: organizationId,
        target_store_id: storeId,
        target_sale_id: saleId,
      }),
  };
}
