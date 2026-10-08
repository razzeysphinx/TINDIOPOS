import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { getCatalogItemCount } from "../../db/catalog-cache";
import { getBusinessContextSnapshot } from "../../db/business-context-cache";
import { getLocalCacheStates } from "../../db/cache-state";
import { getReferenceSnapshot } from "../../db/reference-cache";
import { getActiveShiftSnapshot } from "../../db/shift-cache";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { validateOfflineAuthorizationGrant, type OfflineAuthorizationGrant, type OfflineAuthorizationScope } from "./offline-authorization";

export type OfflineReadiness = { ok: true; grant: OfflineAuthorizationGrant; core: PosBootstrapV2CoreResponse["core"]; catalogItems: number; referenceVersion: string } | { ok: false; reason: string };
export type OfflineScopeReadiness = Omit<Extract<OfflineReadiness, { ok: true }>, "grant"> | Extract<OfflineReadiness, { ok: false }>;

export async function evaluateOfflineScopeReadiness(scope: OfflineAuthorizationScope): Promise<OfflineScopeReadiness> {
  const business = await getBusinessContextSnapshot(scope.organizationId);
  if (!business) return { ok: false, reason: "BUSINESS_CONTEXT_MISSING" };
  const core = business.core;
  if (core.organization.id !== scope.organizationId || core.organization.status !== "active") return { ok: false as const, reason: "ORGANIZATION_INVALID" };
  if (core.profileId !== scope.profileId || core.employee.id !== scope.employeeId) return { ok: false as const, reason: "EMPLOYEE_PROFILE_MISMATCH" };
  const identity = await loadMobileDeviceIdentity(scope.organizationId);
  if (!identity || !identity.binding || identity.credential.deviceId !== scope.deviceId) return { ok: false as const, reason: "DEVICE_MISMATCH" };
  if (identity.binding.storeId !== scope.storeId || identity.binding.registerId !== scope.registerId) return { ok: false as const, reason: "TERMINAL_MISMATCH" };
  const shift = await getActiveShiftSnapshot(scope.organizationId, scope.storeId, scope.registerId);
  if (!shift || shift.shift.id !== scope.shiftId || shift.shift.storeId !== scope.storeId || shift.shift.registerId !== scope.registerId) return { ok: false as const, reason: "SHIFT_MISMATCH" };
  const reference = await getReferenceSnapshot(scope.organizationId);
  if (!reference) return { ok: false, reason: "REFERENCE_MISSING" };
  const states = await getLocalCacheStates(scope.organizationId) as Array<{ domain: string; store_id: string; scope_key: string; is_complete: number }>;
  const catalog = states.find((state) => state.domain === "catalog" && state.store_id === scope.storeId && state.scope_key === "offline-prime" && state.is_complete === 1);
  if (!catalog) return { ok: false, reason: "COMPLETE_CATALOG_MISSING" };
  const catalogItems = await getCatalogItemCount(scope.organizationId, scope.storeId);
  return { ok: true as const, core, catalogItems, referenceVersion: reference.referenceVersion };
}

export async function evaluateOfflineReadiness(): Promise<OfflineReadiness> {
  const authorization = await validateOfflineAuthorizationGrant();
  if (!authorization.ok) return authorization;
  const readiness = await evaluateOfflineScopeReadiness(authorization.grant);
  return readiness.ok
    ? { ...readiness, grant: authorization.grant }
    : readiness;
}
