import type { OwnedBootstrapDependencies } from "./bootstrap-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedBootstrapDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedBootstrapDependencies {
  const runtime = createPosReadRuntime({
    environment,
    fetchImpl,
  });

  return {
    createRequestId,
    verifyClaims: runtime.verifyClaims,
    loadCore: async (token, organizationId) =>
      runtime.callRpc(
        token,
        "get_pos_bootstrap_core_v2",
        organizationId
          ? { target_organization_id: organizationId }
          : {},
      ),
  };
}
