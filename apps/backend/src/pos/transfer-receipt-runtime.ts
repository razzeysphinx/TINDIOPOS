import { createClient } from "@supabase/supabase-js";
import { POS_TRANSFER_RECEIPT_RPC } from "@tindio/contracts/transfer-receipt";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import { toTransferReceiptRpcArguments } from "./transfer-receipt-compatibility.js";
import type { OwnedTransferReceiptDependencies } from "./transfer-receipt-owned.js";

export type TransferReceiptEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: TransferReceiptEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedTransferReceiptDependencies({
  environment,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedTransferReceiptDependencies {
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
    receive: async (token, organizationId, input) => createDatabaseClient(token).rpc(
      POS_TRANSFER_RECEIPT_RPC,
      toTransferReceiptRpcArguments(organizationId, input),
    ),
  };
}
