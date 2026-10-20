import type { OwnedLiveDependencies } from "./live-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedLiveDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedLiveDependencies {
  const runtime = createPosReadRuntime({ environment, fetchImpl });

  return {
    createRequestId,
    verifyClaims: runtime.verifyClaims,
    loadLive: async (token, organizationId, storeId, registerId) =>
      runtime.callRpc(token, "get_pos_live_state_v2", {
        target_organization_id: organizationId,
        target_store_id: storeId,
        target_register_id: registerId,
      }),
  };
}
