import type { OwnedAttendanceEmployeesDependencies } from "./attendance-employees-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedAttendanceEmployeesDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedAttendanceEmployeesDependencies {
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
    loadAttendanceEmployees: async (token, organizationId, storeId) =>
      runtime.callRpc(token, "get_attendance_employees", {
        target_organization_id: organizationId,
        target_store_id: storeId,
      }),
  };
}
