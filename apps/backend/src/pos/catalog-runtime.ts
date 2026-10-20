import type { OwnedCatalogDependencies } from "./catalog-owned.js";
import {
  createPosReadRuntime,
  type PosReadEnvironment,
} from "./pos-read-runtime.js";

type RuntimeOptions = {
  environment: PosReadEnvironment;
  createRequestId: () => string;
  fetchImpl?: typeof fetch;
};

export function createOwnedCatalogDependencies({
  environment,
  createRequestId,
  fetchImpl = fetch,
}: RuntimeOptions): OwnedCatalogDependencies {
  const runtime = createPosReadRuntime({ environment, fetchImpl });

  return {
    createRequestId,
    verifyClaims: runtime.verifyClaims,
    loadCatalog: async (token, organizationId, query) =>
      runtime.callRpc(token, "get_pos_catalog_v2", {
        target_organization_id: organizationId,
        target_store_id: query.store,
        target_mode: query.mode,
        target_query: query.query || undefined,
        target_category_id: query.category,
        target_offset: query.offset,
        target_limit: query.limit,
      }),
  };
}
