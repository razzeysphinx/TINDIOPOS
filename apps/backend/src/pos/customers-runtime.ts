import type { OwnedCustomersDependencies } from "./customers-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedCustomersDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedCustomersDependencies {
  const runtime = createPosReadRuntime({ environment, fetchImpl });

  return {
    createRequestId,
    verifyClaims: runtime.verifyClaims,
    loadCore: async (token, organizationId) =>
      runtime.callRpc(
        token,
        "get_pos_bootstrap_core_v2",
        organizationId ? { target_organization_id: organizationId } : {},
      ),
    findActiveShift: async (token, organizationId, storeId, employeeId) =>
      runtime.findOpenShift(token, organizationId, storeId, employeeId),
    searchCustomers: async (token, organizationId, query) =>
      runtime.callRpc(token, "search_pos_customers", {
        target_organization_id: organizationId,
        target_store_id: query.store,
        target_query: query.query,
        target_limit: 8,
      }),
  };
}
