import { createClient } from "@supabase/supabase-js";
import {
  POS_CUSTOMER_CREATION_SELECT,
  POS_CUSTOMER_CREATION_TABLE,
} from "@tindio/contracts/customer-creation";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import type { OwnedCustomerCreationDependencies } from "./customer-creation-owned.js";

export type CustomerCreationEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: CustomerCreationEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedCustomerCreationDependencies({
  environment,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedCustomerCreationDependencies {
  const supabaseUrl = requiredHttpUrl("SUPABASE_URL", environment.SUPABASE_URL);
  const neonDataApiUrl = requiredHttpUrl("NEON_DATA_API_URL", environment.NEON_DATA_API_URL);
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: fetchImpl },
  });
  const databaseFetch = createNeonDataApiFetch({ supabaseUrl, neonDataApiUrl, fetchImpl });
  const createDatabaseClient = (token: string) => createClient(supabaseUrl, publishableKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: databaseFetch },
  });

  return {
    verifyClaims: async (token) => authClient.auth.getClaims(token),
    loadCore: async (token, organizationId) => createDatabaseClient(token).rpc(
      "get_pos_bootstrap_core_v2",
      organizationId ? { target_organization_id: organizationId } : {},
    ),
    createCustomer: async (token, organizationId, input) => createDatabaseClient(token)
      .from(POS_CUSTOMER_CREATION_TABLE)
      .insert({
        organization_id: organizationId,
        full_name: input.fullName,
        email: input.email || null,
        phone: input.phone || null,
        address: input.address || null,
        birthday: input.birthday || null,
        notes: input.notes || null,
        loyalty_card_code: input.loyaltyCardCode || undefined,
      })
      .select(POS_CUSTOMER_CREATION_SELECT)
      .single(),
  };
}
