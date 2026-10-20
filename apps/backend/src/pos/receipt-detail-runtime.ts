import type { OwnedReceiptDetailDependencies } from "./receipt-detail-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedReceiptDetailDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedReceiptDetailDependencies {
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
    loadReceiptDetail: async (token, organizationId, receiptId) =>
      runtime.callRpc(token, "get_pos_receipt_detail", {
        target_organization_id: organizationId,
        target_receipt_id: receiptId,
      }),
  };
}
