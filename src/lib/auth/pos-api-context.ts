import "server-only";

import {
  getBusinessContext,
  type BusinessContext,
} from "@/lib/auth/dal";

/**
 * Phase 01 transport adapter.
 *
 * Today this intentionally resolves the existing cookie/session BusinessContext.
 * Phase 02 will extend this single boundary to support mobile Bearer auth without
 * rewriting every POS API route.
 */
export async function getPosApiBusinessContext(
  request: Request,
): Promise<BusinessContext | null> {
  void request;
  return getBusinessContext();
}
