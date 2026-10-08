import type { PosBootstrapV2CoreResponse } from "../../../../../src/contracts/pos";
import { saveBusinessContextSnapshot } from "../../db/business-context-cache";
import { saveActiveShiftSnapshot } from "../../db/shift-cache";
import { isShiftFinalizationInProgress } from "../../db/shift-custody";
import {
  acquirePosV2ShiftCustody,
  validatePosV2Device,
} from "../../lib/tindio-api";
import {
  loadMobileDeviceIdentity,
  saveMobileDeviceIdentity,
} from "../device/device-store";
import { saveOfflineAuthorizationGrant } from "./offline-authorization";
import { evaluateOfflineScopeReadiness } from "./offline-readiness";

export type OfflineRenewalResult =
  | { ok: true; expiresAt: string }
  | { ok: false; reason: string };

async function attemptOfflineAuthorizationRenewal(
  core: PosBootstrapV2CoreResponse["core"],
): Promise<OfflineRenewalResult> {
  if (core.organization.status !== "active") {
    return { ok: false, reason: "ORGANIZATION_NOT_ACTIVE" };
  }
  const shift = core.activeShift;
  if (!shift) return { ok: false, reason: "ACTIVE_SHIFT_REQUIRED" };

  const stored = await loadMobileDeviceIdentity(core.organization.id);
  if (!stored?.binding) return { ok: false, reason: "DEVICE_NOT_ENROLLED" };
  if (!core.storeIds.includes(stored.binding.storeId)) {
    return { ok: false, reason: "STORE_ASSIGNMENT_REVOKED" };
  }
  if (
    shift.storeId !== stored.binding.storeId
    || shift.registerId !== stored.binding.registerId
  ) return { ok: false, reason: "SHIFT_TERMINAL_MISMATCH" };
  if (await isShiftFinalizationInProgress(core.organization.id, shift.id)) {
    return { ok: false, reason: "SHIFT_FINALIZATION_IN_PROGRESS" };
  }

  const validation = await validatePosV2Device(
    core.organization.id,
    stored.credential,
  );
  if (!validation.ok) return { ok: false, reason: "DEVICE_REJECTED" };
  if (
    validation.device.deviceId !== stored.credential.deviceId
    || validation.device.storeId !== stored.binding.storeId
    || validation.device.registerId !== stored.binding.registerId
  ) return { ok: false, reason: "DEVICE_BINDING_CHANGED" };

  await saveBusinessContextSnapshot(core);
  await saveActiveShiftSnapshot(core.organization.id, shift);
  await saveMobileDeviceIdentity({
    ...stored,
    binding: validation.device,
    lastVerifiedAt: new Date().toISOString(),
  });

  const scope = {
    organizationId: core.organization.id,
    profileId: core.profileId,
    employeeId: core.employee.id,
    deviceId: stored.credential.deviceId,
    storeId: validation.device.storeId,
    registerId: validation.device.registerId,
    shiftId: shift.id,
  };
  const readiness = await evaluateOfflineScopeReadiness(scope);
  if (!readiness.ok) return readiness;

  const custody = await acquirePosV2ShiftCustody(
    core.organization.id,
    stored.credential,
    shift.id,
  );
  if (
    !custody.ok
    || custody.deviceId !== stored.credential.deviceId
    || custody.shiftId !== shift.id
    || custody.state !== "ACTIVE"
  ) {
    return { ok: false, reason: "SHIFT_CUSTODY_UNAVAILABLE" };
  }

  const grant = await saveOfflineAuthorizationGrant(scope);
  return { ok: true, expiresAt: grant.expiresAt };
}

export async function renewOfflineAuthorizationFromCloud(
  core: PosBootstrapV2CoreResponse["core"],
): Promise<OfflineRenewalResult> {
  try {
    return await attemptOfflineAuthorizationRenewal(core);
  } catch {
    return { ok: false, reason: "OFFLINE_RENEWAL_UNAVAILABLE" };
  }
}
