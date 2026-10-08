import type { OutboxRecoveryItem } from "./outbox-types";

export type OutboxRecoveryActor = {
  organizationId: string;
  profileId: string;
  employeeId: string;
  permissions: readonly string[];
  storeIds: readonly string[];
  deviceId: string;
  storeId: string;
  registerId: string;
};

export type OutboxRecoveryDecision =
  | { ok: true; requiresManagerReview: boolean }
  | { ok: false; reason: string };

const CHECKOUT_PERMISSIONS = ["pos.access", "sales.create", "payments.accept"];
const NON_RETRYABLE_CONFLICTS = new Set([
  "LOCAL_SEQUENCE_GAP",
  "SEQUENCE_GAP",
  "SEQUENCE_CONFLICT",
  "SEQUENCE_OUT_OF_ORDER",
  "IDEMPOTENCY_SEQUENCE_MISMATCH",
  "DUPLICATE_TRANSACTION",
]);

export function evaluateOutboxRecovery(
  event: OutboxRecoveryItem,
  actor: OutboxRecoveryActor,
): OutboxRecoveryDecision {
  if (event.corrupt) return { ok: false, reason: "CORRUPT_EVENT_REQUIRES_ESCALATION" };
  if (event.organizationId !== actor.organizationId) return { ok: false, reason: "TENANT_MISMATCH" };
  if (event.deviceId !== actor.deviceId) return { ok: false, reason: "DEVICE_MISMATCH" };
  if (!actor.storeIds.includes(event.storeId)) return { ok: false, reason: "STORE_ACCESS_REQUIRED" };
  if (event.storeId !== actor.storeId || event.registerId !== actor.registerId) {
    return { ok: false, reason: "TERMINAL_BINDING_REVALIDATION_REQUIRED" };
  }
  if (!CHECKOUT_PERMISSIONS.every((permission) => actor.permissions.includes(permission))) {
    return { ok: false, reason: "CHECKOUT_PERMISSION_REQUIRED" };
  }
  if (event.state !== "FAILED" && event.state !== "CONFLICT") {
    return { ok: false, reason: "EVENT_NOT_IN_REVIEW" };
  }

  const managerReview = event.state === "CONFLICT" || event.employeeId !== actor.employeeId;
  if (managerReview && !actor.permissions.includes("sales.refund")) {
    return { ok: false, reason: "FINANCIAL_MANAGER_REVIEW_REQUIRED" };
  }
  if (event.state === "CONFLICT" && NON_RETRYABLE_CONFLICTS.has(event.conflictType ?? "")) {
    return { ok: false, reason: "SEQUENCE_ESCALATION_REQUIRED" };
  }
  return { ok: true, requiresManagerReview: managerReview };
}
