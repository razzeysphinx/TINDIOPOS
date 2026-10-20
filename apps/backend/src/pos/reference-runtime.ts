import type { OwnedReferenceDependencies } from "./reference-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedReferenceDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedReferenceDependencies {
  const runtime = createPosReadRuntime({ environment, fetchImpl });

  return {
    createRequestId,
    verifyClaims: runtime.verifyClaims,
    loadReference: async (token, organizationId) =>
      runtime.callRpc(
        token,
        "get_pos_reference_bundle_v2",
        organizationId
          ? { target_organization_id: organizationId }
          : {},
      ),
  };
}
