import type { OwnedReceiptsDependencies } from "./receipts-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedReceiptsDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedReceiptsDependencies {
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
    loadReceipts: async (token, organizationId, query) =>
      runtime.callRpc(token, "get_pos_receipt_history", {
        target_organization_id: organizationId,
        target_query: query.query || null,
        target_before_receipt_number: query.beforeReceiptNumber ?? null,
        target_limit: 25,
      }),
  };
}
