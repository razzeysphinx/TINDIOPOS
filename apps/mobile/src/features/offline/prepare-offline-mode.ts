import type { PosCatalogItem } from "../../../../../src/features/pos/pos-types";
import { replaceCompleteCatalogSnapshot } from "../../db/catalog-cache";
import { saveBusinessContextSnapshot } from "../../db/business-context-cache";
import { saveReferenceSnapshot } from "../../db/reference-cache";
import { saveActiveShiftSnapshot } from "../../db/shift-cache";
import { fetchPosV2CatalogPage, fetchPosV2Core, fetchPosV2Reference, validatePosV2Device } from "../../lib/tindio-api";
import { loadMobileDeviceIdentity, saveMobileDeviceIdentity } from "../device/device-store";
import { saveOfflineAuthorizationGrant } from "./offline-authorization";

export type OfflinePreparationResult = { ok: true; expiresAt: string; catalogItems: number } | { ok: false; reason: string };
const PAGE_SIZE = 24;
const MAX_OFFSET = 10_000;

export async function prepareOfflineMode(organizationId: string): Promise<OfflinePreparationResult> {
  let coreResponse;
  try { coreResponse = await fetchPosV2Core(organizationId); } catch { return { ok: false, reason: "BUSINESS_CONTEXT_UNAVAILABLE" }; }
  const core = coreResponse.core;
  if (core.organization.id !== organizationId || core.organization.status !== "active") return { ok: false, reason: "ORGANIZATION_NOT_ACTIVE" };
  const stored = await loadMobileDeviceIdentity(organizationId);
  if (!stored || !stored.binding) return { ok: false, reason: "DEVICE_NOT_ENROLLED" };

  let validation;
  try { validation = await validatePosV2Device(organizationId, stored.credential); } catch { return { ok: false, reason: "DEVICE_REJECTED" }; }
  if (!validation.ok) return { ok: false, reason: "DEVICE_REJECTED" };
  if (validation.device.deviceId !== stored.credential.deviceId || validation.device.storeId !== stored.binding.storeId || validation.device.registerId !== stored.binding.registerId) return { ok: false, reason: "DEVICE_BINDING_CHANGED" };
  const binding = validation.device;
  const shift = core.activeShift;
  if (!shift) return { ok: false, reason: "ACTIVE_SHIFT_REQUIRED" };
  if (shift.storeId !== binding.storeId || shift.registerId !== binding.registerId) return { ok: false, reason: "SHIFT_TERMINAL_MISMATCH" };

  let reference;
  try { reference = await fetchPosV2Reference(organizationId); } catch { return { ok: false, reason: "REFERENCE_UNAVAILABLE" }; }
  if (reference.organizationId !== organizationId) return { ok: false, reason: "REFERENCE_TENANT_MISMATCH" };

  const items: PosCatalogItem[] = [];
  let offset = 0;
  while (true) {
    if (offset > MAX_OFFSET) return { ok: false, reason: "CATALOG_EXCEEDS_PHASE_08_BOUNDARY" };
    let page;
    try { page = await fetchPosV2CatalogPage(organizationId, binding.storeId, { offset, limit: PAGE_SIZE }); } catch { return { ok: false, reason: "CATALOG_UNAVAILABLE" }; }
    if (page.organizationId !== organizationId || page.storeId !== binding.storeId) return { ok: false, reason: "CATALOG_SCOPE_MISMATCH" };
    items.push(...page.items);
    if (!page.hasMore) break;
    const nextOffset = offset + page.limit;
    if (page.limit <= 0 || nextOffset <= offset) return { ok: false, reason: "CATALOG_PAGINATION_STALLED" };
    offset = nextOffset;
  }

  try {
    await saveBusinessContextSnapshot(core);
    await saveActiveShiftSnapshot(organizationId, shift);
    await saveReferenceSnapshot(reference);
    await replaceCompleteCatalogSnapshot(organizationId, binding.storeId, items);
    await saveMobileDeviceIdentity({ ...stored, binding, lastVerifiedAt: new Date().toISOString() });
  } catch { return { ok: false, reason: "CACHE_PERSISTENCE_FAILED" }; }

  try {
    const grant = await saveOfflineAuthorizationGrant({ organizationId, profileId: core.profileId, employeeId: core.employee.id, deviceId: stored.credential.deviceId, storeId: binding.storeId, registerId: binding.registerId, shiftId: shift.id });
    return { ok: true, expiresAt: grant.expiresAt, catalogItems: items.length };
  } catch { return { ok: false, reason: "OFFLINE_AUTHORIZATION_PERSISTENCE_FAILED" }; }
}
