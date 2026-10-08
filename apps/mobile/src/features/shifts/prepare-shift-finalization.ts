import { recoverInterruptedOnlineCheckoutIntents } from "../../db/checkout-intents";
import { getShiftFinalizationCustody } from "../../db/shift-custody";
import { refreshDeviceCheckpoint } from "../outbox/checkpoint-sync";
import { syncOutboxEvents } from "../outbox/outbox-sync";
import {
  evaluateShiftFinalization,
  shiftFinalizationMessage,
  type ShiftFinalizationDecision,
} from "./shift-finalization-policy";

export type ShiftFinalizationPreparation = ShiftFinalizationDecision & {
  message: string;
};

export async function prepareShiftFinalization(input: {
  organizationId: string;
  deviceId: string;
  storeId: string;
  registerId: string;
  shiftId: string;
}): Promise<ShiftFinalizationPreparation> {
  try {
    await recoverInterruptedOnlineCheckoutIntents(input.organizationId, input.deviceId);
    await syncOutboxEvents(input.organizationId);
    const checkpoint = await refreshDeviceCheckpoint(input.organizationId);
    const custody = await getShiftFinalizationCustody(input);
    const decision = evaluateShiftFinalization(custody, checkpoint.ok);
    return decision.ok
      ? { ok: true, message: "This device has no unresolved money and its sequence is acknowledged." }
      : { ...decision, message: shiftFinalizationMessage(decision.reason) };
  } catch {
    return {
      ok: false,
      reason: "CHECKPOINT_UNAVAILABLE",
      message: shiftFinalizationMessage("CHECKPOINT_UNAVAILABLE"),
    };
  }
}
