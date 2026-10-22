import { createClient } from "@supabase/supabase-js";
import type { CheckoutSaleActionResult } from "@tindio/contracts/checkout";
import { POS_SYNC_PUSH_DEVICE_RPC } from "@tindio/contracts/sync-push";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import { createOwnedOfflineCheckoutDependencies } from "./offline-checkout-runtime.js";
import { handleOwnedOfflineCheckout } from "./offline-checkout-owned.js";
import { toSyncPushDeviceRpcArguments } from "./sync-push-compatibility.js";
import type { OwnedSyncPushDependencies } from "./sync-push-owned.js";

export type SyncPushEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: SyncPushEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedSyncPushDependencies({
  environment,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedSyncPushDependencies {
  const supabaseUrl = requiredHttpUrl("SUPABASE_URL", environment.SUPABASE_URL);
  const neonDataApiUrl = requiredHttpUrl("NEON_DATA_API_URL", environment.NEON_DATA_API_URL);
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");

  const authClient = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: fetchImpl },
  });
  const databaseFetch = createNeonDataApiFetch({ supabaseUrl, neonDataApiUrl, fetchImpl });
  const createDatabaseClient = (token: string, device?: {
    deviceId: string;
    secret: string;
    appVersion: string;
  } | null) => createClient(supabaseUrl, publishableKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: databaseFetch,
      headers: device ? {
        "x-tindio-device-id": device.deviceId,
        "x-tindio-device-secret": device.secret,
        "x-tindio-app-version": device.appVersion,
      } : undefined,
    },
  });
  const offlineDependencies = createOwnedOfflineCheckoutDependencies({
    environment,
    fetchImpl,
  });

  return {
    verifyClaims: async (token) => authClient.auth.getClaims(token),
    loadCore: async (token, organizationId) => createDatabaseClient(token).rpc(
      "get_pos_bootstrap_core_v2",
      organizationId ? { target_organization_id: organizationId } : {},
    ),
    validateDevice: async (token, organizationId, input) =>
      createDatabaseClient(token, input.device).rpc(
        POS_SYNC_PUSH_DEVICE_RPC,
        toSyncPushDeviceRpcArguments(organizationId, input),
      ),
    processOfflineCheckout: async (token, claims, core, input) => {
      const request = new Request("https://backend.internal/api/pos/v2/offline-checkout", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-tindio-organization-id": core.organization.id,
        },
        body: JSON.stringify(input),
      });
      const response = await handleOwnedOfflineCheckout(request, {
        ...offlineDependencies,
        verifyClaims: async () => ({ data: { claims }, error: null }),
        loadCore: async () => ({ data: core, error: null }),
      });
      return {
        status: response.status,
        result: await response.json() as CheckoutSaleActionResult,
      };
    },
  };
}
