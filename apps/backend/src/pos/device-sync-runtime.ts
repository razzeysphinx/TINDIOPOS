import { createClient } from "@supabase/supabase-js";
import type { PosDeviceCredential } from "@tindio/contracts/device";

import { createNeonDataApiFetch } from "../database/neon-data-api-fetch.js";
import type { OwnedDeviceSyncDependencies } from "./device-sync-owned.js";

export type DeviceSyncEnvironment = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  NEON_DATA_API_URL?: string;
};
type RuntimeOptions = { environment: DeviceSyncEnvironment; fetchImpl?: typeof fetch };

function requiredHttpUrl(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required`);
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials`);
  }
  return url.toString();
}

export function createOwnedDeviceSyncDependencies({ environment, fetchImpl = fetch }: RuntimeOptions): OwnedDeviceSyncDependencies {
  const supabaseUrl = requiredHttpUrl("SUPABASE_URL", environment.SUPABASE_URL);
  const neonDataApiUrl = requiredHttpUrl("NEON_DATA_API_URL", environment.NEON_DATA_API_URL);
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;
  if (!publishableKey) throw new Error("SUPABASE_PUBLISHABLE_KEY is required");
  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: fetchImpl },
  });
  const databaseFetch = createNeonDataApiFetch({ supabaseUrl, neonDataApiUrl, fetchImpl });
  const database = (token: string, device?: PosDeviceCredential | null) => createClient(supabaseUrl, publishableKey, {
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
    verifyClaims: async (token) => auth.auth.getClaims(token),
    loadCore: async (token, organizationId) => database(token).rpc(
      "get_pos_bootstrap_core_v2",
      organizationId ? { target_organization_id: organizationId } : {},
    ),
    rpc: async (token, name, args, device) => database(token, device).rpc(name, args),
  };
}
