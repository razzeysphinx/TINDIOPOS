import type { ShiftFinalizationCustody } from "../../db/shift-custody";

export type ShiftFinalizationBlockReason =
  | "CHECKPOINT_UNAVAILABLE"
  | "ONLINE_CHECKOUT_UNRESOLVED"
  | "OUTBOX_REVIEW_REQUIRED"
  | "OUTBOX_SYNC_REQUIRED"
  | "CHECKPOINT_NOT_RECONCILED";

export type ShiftFinalizationDecision =
  | { ok: true }
  | { ok: false; reason: ShiftFinalizationBlockReason };

export function evaluateShiftFinalization(
  custody: ShiftFinalizationCustody,
  checkpointVerified: boolean,
): ShiftFinalizationDecision {
  if (!checkpointVerified) return { ok: false, reason: "CHECKPOINT_UNAVAILABLE" };
  if (custody.unresolvedCheckoutCount > 0) {
    return { ok: false, reason: "ONLINE_CHECKOUT_UNRESOLVED" };
  }
  if (custody.reviewOutboxCount > 0) {
    return { ok: false, reason: "OUTBOX_REVIEW_REQUIRED" };
  }
  if (custody.unresolvedOutboxCount > 0) {
    return { ok: false, reason: "OUTBOX_SYNC_REQUIRED" };
  }
  if (custody.localHighWater !== custody.serverCheckpoint) {
    return { ok: false, reason: "CHECKPOINT_NOT_RECONCILED" };
  }
  return { ok: true };
}

export function shiftFinalizationMessage(reason: ShiftFinalizationBlockReason) {
  switch (reason) {
    case "ONLINE_CHECKOUT_UNRESOLVED":
      return "Shift close blocked: an online checkout result is unresolved. Return to POS and recover the original checkout first.";
    case "OUTBOX_REVIEW_REQUIRED":
      return "Shift close blocked: saved sales require review in Sync status. Resolve them with their original transaction identities.";
    case "OUTBOX_SYNC_REQUIRED":
      return "Shift close blocked: saved sales are not yet acknowledged by TINDIO. Sync this device before counting the drawer.";
    case "CHECKPOINT_NOT_RECONCILED":
      return "Shift close blocked: this device sequence is not fully acknowledged by TINDIO.";
    default:
      return "Shift close blocked: TINDIO could not verify this device's transaction checkpoint.";
  }
}
