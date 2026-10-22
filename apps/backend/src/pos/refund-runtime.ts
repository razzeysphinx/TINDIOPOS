import { createClient } from "@supabase/supabase-js";
import { POS_REFUND_RPC } from "@tindio/contracts/refund";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import { toRefundRpcArguments } from "./refund-compatibility.js";
import type { OwnedRefundDependencies } from "./refund-owned.js";

export type RefundEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: RefundEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedRefundDependencies({
  environment,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedRefundDependencies {
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
    loadReceiptDetail: async (token, organizationId, receiptId) => createDatabaseClient(token).rpc(
      "get_pos_receipt_detail",
      {
        target_organization_id: organizationId,
        target_receipt_id: receiptId,
      },
    ),
    refund: async (token, organizationId, input) => createDatabaseClient(token).rpc(
      POS_REFUND_RPC,
      toRefundRpcArguments(organizationId, input),
    ),
  };
}
