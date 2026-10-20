import type { OwnedModifiersDependencies } from "./modifiers-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedModifiersDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedModifiersDependencies {
  const runtime = createPosReadRuntime({ environment, fetchImpl });

  return {
    createRequestId,
    verifyClaims: runtime.verifyClaims,
    loadModifiers: async (token, organizationId, query) =>
      runtime.callRpc(token, "get_pos_modifiers_v2", {
        target_organization_id: organizationId,
        target_store_id: query.store,
        target_product_id: query.product,
      }),
  };
}
