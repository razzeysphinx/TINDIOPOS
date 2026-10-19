import type { PosBootstrapV2CoreResponse } from "@tindio/contracts";
import {
  authorizeOutboxRecoveryRetry,
  listOutboxRecoveryItems,
} from "../../db/outbox";
import type { MobileDeviceIdentity } from "../device/device-store";
import { syncOutboxEvents } from "./outbox-sync";
import { evaluateOutboxRecovery } from "./recovery-policy";

export async function retryReviewedOutboxEvent(input: {
  organizationId: string;
  eventId: string;
  reason: string;
  core: PosBootstrapV2CoreResponse["core"];
  identity: MobileDeviceIdentity;
}) {
  const binding = input.identity.binding;
  if (!binding) return { ok: false as const, reason: "DEVICE_REVALIDATION_REQUIRED" };
  const event = (await listOutboxRecoveryItems(
    input.organizationId,
    input.identity.credential.deviceId,
  )).find((candidate) => candidate.eventId === input.eventId);
  if (!event) return { ok: false as const, reason: "EVENT_NOT_FOUND" };

  const decision = evaluateOutboxRecovery(event, {
    organizationId: input.core.organization.id,
    profileId: input.core.profileId,
    employeeId: input.core.employee.id,
    permissions: input.core.permissions,
    storeIds: input.core.storeIds,
    deviceId: input.identity.credential.deviceId,
    storeId: binding.storeId,
    registerId: binding.registerId,
  });
  if (!decision.ok) return decision;

  const reason = input.reason.trim();
  if (decision.requiresManagerReview && reason.length < 8) {
    return { ok: false as const, reason: "RECOVERY_NOTE_REQUIRED" };
  }

  await authorizeOutboxRecoveryRetry({
    organizationId: input.organizationId,
    deviceId: input.identity.credential.deviceId,
    eventId: input.eventId,
    actorProfileId: input.core.profileId,
    actorEmployeeId: input.core.employee.id,
    reason: reason || "Reauthenticated employee retry.",
  });
  const report = await syncOutboxEvents(input.organizationId);
  return { ok: true as const, report };
}
