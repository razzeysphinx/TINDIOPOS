import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { getCatalogItemCount } from "../../db/catalog-cache";
import { getBusinessContextSnapshot } from "../../db/business-context-cache";
import { getLocalCacheStates } from "../../db/cache-state";
import { getReferenceSnapshot } from "../../db/reference-cache";
import { getActiveShiftSnapshot } from "../../db/shift-cache";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { validateOfflineAuthorizationGrant, type OfflineAuthorizationGrant } from "./offline-authorization";

export type OfflineReadiness = { ok: true; grant: OfflineAuthorizationGrant; core: PosBootstrapV2CoreResponse["core"]; catalogItems: number; referenceVersion: string } | { ok: false; reason: string };

export async function evaluateOfflineReadiness(): Promise<OfflineReadiness> {
  const authorization = await validateOfflineAuthorizationGrant();
  if (!authorization.ok) return authorization;
  const grant = authorization.grant;
  const business = await getBusinessContextSnapshot(grant.organizationId);
  if (!business) return { ok: false, reason: "BUSINESS_CONTEXT_MISSING" };
  const core = business.core;
  if (core.organization.id !== grant.organizationId || core.organization.status !== "active") return { ok: false, reason: "ORGANIZATION_INVALID" };
  if (core.profileId !== grant.profileId || core.employee.id !== grant.employeeId) return { ok: false, reason: "EMPLOYEE_PROFILE_MISMATCH" };
  const identity = await loadMobileDeviceIdentity(grant.organizationId);
  if (!identity || !identity.binding || identity.credential.deviceId !== grant.deviceId) return { ok: false, reason: "DEVICE_MISMATCH" };
  if (identity.binding.storeId !== grant.storeId || identity.binding.registerId !== grant.registerId) return { ok: false, reason: "TERMINAL_MISMATCH" };
  const shift = await getActiveShiftSnapshot(grant.organizationId, grant.storeId, grant.registerId);
  if (!shift || shift.shift.id !== grant.shiftId || shift.shift.storeId !== grant.storeId || shift.shift.registerId !== grant.registerId) return { ok: false, reason: "SHIFT_MISMATCH" };
  const reference = await getReferenceSnapshot(grant.organizationId);
  if (!reference) return { ok: false, reason: "REFERENCE_MISSING" };
  const states = await getLocalCacheStates(grant.organizationId) as Array<{ domain: string; store_id: string; scope_key: string; is_complete: number }>;
  const catalog = states.find((state) => state.domain === "catalog" && state.store_id === grant.storeId && state.scope_key === "offline-prime" && state.is_complete === 1);
  if (!catalog) return { ok: false, reason: "COMPLETE_CATALOG_MISSING" };
  const catalogItems = await getCatalogItemCount(grant.organizationId, grant.storeId);
  return { ok: true, grant, core, catalogItems, referenceVersion: reference.referenceVersion };
}
