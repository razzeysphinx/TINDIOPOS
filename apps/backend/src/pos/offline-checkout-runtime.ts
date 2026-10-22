import { createClient } from "@supabase/supabase-js";
import { POS_CHECKOUT_RPC, POS_CHECKOUT_STOCK_WARNING_RPC } from "@tindio/contracts/checkout";
import {
  POS_OFFLINE_CHECKOUT_DEVICE_RPC,
  POS_OFFLINE_CHECKOUT_FINALIZE_RPC,
  POS_OFFLINE_CHECKOUT_RECORD_RPC,
  POS_OFFLINE_CHECKOUT_RESERVE_RPC,
} from "@tindio/contracts/offline-checkout";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import {
  toOfflineCheckoutRpcArguments,
  toOfflineRecordArguments,
  toOfflineSequenceReservationArguments,
} from "./offline-checkout-compatibility.js";
import type { OwnedOfflineCheckoutDependencies } from "./offline-checkout-owned.js";

export type OfflineCheckoutEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: OfflineCheckoutEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedOfflineCheckoutDependencies({
  environment,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedOfflineCheckoutDependencies {
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

  return {
    verifyClaims: async (token) => authClient.auth.getClaims(token),
    loadCore: async (token, organizationId) => createDatabaseClient(token).rpc(
      "get_pos_bootstrap_core_v2",
      organizationId ? { target_organization_id: organizationId } : {},
    ),
    validateDevice: async (token, organizationId, intent) =>
      createDatabaseClient(token, intent.device).rpc(POS_OFFLINE_CHECKOUT_DEVICE_RPC, {
        target_organization_id: organizationId,
        target_device_id: intent.device.deviceId,
        target_secret: intent.device.secret,
        target_app_version: intent.device.appVersion,
      }),
    reserveSequence: async (token, organizationId, intent) =>
      createDatabaseClient(token, intent.device).rpc(
        POS_OFFLINE_CHECKOUT_RESERVE_RPC,
        toOfflineSequenceReservationArguments(organizationId, intent),
      ),
    loadPaymentMethod: async (token, organizationId, paymentMethodId, device) =>
      createDatabaseClient(token, device)
        .from("payment_methods")
        .select("payment_type, offline_policy")
        .eq("organization_id", organizationId)
        .eq("id", paymentMethodId)
        .maybeSingle(),
    checkout: async (token, organizationId, input, device) =>
      createDatabaseClient(token, device).rpc(
        POS_CHECKOUT_RPC,
        toOfflineCheckoutRpcArguments(organizationId, input),
      ),
    loadStockWarning: async (token, organizationId, storeId, saleId) =>
      createDatabaseClient(token).rpc(POS_CHECKOUT_STOCK_WARNING_RPC, {
        target_organization_id: organizationId,
        target_store_id: storeId,
        target_sale_id: saleId,
      }),
    finalizeSequence: async (token, organizationId, intent, finalState) =>
      createDatabaseClient(token, intent.device).rpc(POS_OFFLINE_CHECKOUT_FINALIZE_RPC, {
        target_organization_id: organizationId,
        target_device_id: intent.device.deviceId,
        target_device_sequence: intent.offline.deviceSequence,
        target_idempotency_key: intent.checkout.idempotencyKey,
        target_final_state: finalState,
      }),
    recordOutcome: async (token, organizationId, body, result, device) =>
      createDatabaseClient(token, device).rpc(
        POS_OFFLINE_CHECKOUT_RECORD_RPC,
        toOfflineRecordArguments(organizationId, body, result),
      ),
  };
}
