import { z } from "zod";

import { posDeviceCredentialSchema } from "@tindio/contracts/device";
import type { PosClientUpgradeRequiredResponse } from "@tindio/contracts/pos-operations";
export type { PosCloseShiftV2Response, PosOpenShiftV2Response } from "@tindio/contracts/pos-operations";

export const POS_SHIFT_OPEN_PATH = "/api/pos/v2/shifts/open" as const;
export const POS_SHIFT_CLOSE_PATH = "/api/pos/v2/shifts/close" as const;
export const POS_SHIFT_CUSTODY_PATH = "/api/pos/v2/shifts/custody" as const;
export const POS_SHIFT_CASH_MOVEMENT_PATH = "/api/pos/v2/shifts/cash-movement" as const;

export const POS_SHIFT_OPEN_RPC = "open_register_shift" as const;
export const POS_SHIFT_CLOSE_RPC = "close_register_shift_mobile" as const;
export const POS_SHIFT_CUSTODY_RPC = "acquire_pos_shift_custody" as const;
export const POS_SHIFT_CASH_MOVEMENT_RPC = "record_cash_movement" as const;

export const POS_SHIFT_OPEN_PERMISSION = "shifts.open" as const;
export const POS_SHIFT_CLOSE_PERMISSION = "shifts.close" as const;
export const POS_CASH_PAY_IN_PERMISSION = "cash.pay_in" as const;
export const POS_CASH_PAY_OUT_PERMISSION = "cash.pay_out" as const;
export const MOBILE_SHIFT_CUSTODY_CAPABILITY = "SHIFT_CUSTODY_FINALIZATION_V1" as const;

export const POS_SHIFT_OPEN_PERMISSION_MESSAGE = "You do not have permission to open register shifts." as const;
export const POS_SHIFT_OPEN_INVALID_MESSAGE = "Choose an assigned register and enter a valid opening cash amount." as const;
export const POS_SHIFT_OPEN_UNAVAILABLE_MESSAGE = "TINDIO could not open this register shift." as const;
export const POS_SHIFT_CLOSE_PERMISSION_MESSAGE = "You do not have permission to close register shifts." as const;
export const POS_SHIFT_CLOSE_INVALID_MESSAGE = "Enter the counted cash and provide a valid reconciled device checkpoint." as const;
export const POS_SHIFT_CLOSE_UNAVAILABLE_MESSAGE = "TINDIO could not close this register shift." as const;
export const POS_SHIFT_CLOSE_PENDING_CUSTODY_MESSAGE = "This device is reconciled, but another device still has offline transaction custody. Bring every device online and retry this same close." as const;
export const POS_SHIFT_CUSTODY_INVALID_MESSAGE = "A valid shift and enrolled device are required." as const;
export const POS_SHIFT_CUSTODY_UNAVAILABLE_MESSAGE = "TINDIO could not establish offline shift custody." as const;
export const POS_CASH_MOVEMENT_INVALID_MESSAGE = "Enter a positive amount and a reason of at least two characters." as const;
export const POS_CASH_MOVEMENT_PERMISSION_MESSAGE = "You do not have permission for this cash movement." as const;
export const POS_CASH_MOVEMENT_UNAVAILABLE_MESSAGE = "TINDIO could not record this cash movement." as const;
export const POS_CASH_OPERATION_PERMISSION_MESSAGE = "You do not have permission for this cash operation." as const;

export const shiftMoneyInputSchema = z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter a valid non-negative amount.");
const cashMovementAmountSchema = z.string().trim().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter a valid positive amount.");
const optionalNote = z.string().trim().max(500).optional();
export const openShiftSchema = z.object({ storeId: z.uuid(), registerId: z.uuid(), openingCash: shiftMoneyInputSchema, openingNote: optionalNote });
export const openShiftSubmissionSchema = openShiftSchema.extend({ device: posDeviceCredentialSchema.nullable().optional() });
export const closeShiftSchema = z.object({ shiftId: z.uuid(), countedCash: shiftMoneyInputSchema, closingNote: optionalNote });
export const mobileCloseShiftSchema = closeShiftSchema.extend({
  device: posDeviceCredentialSchema,
  localHighWater: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  finalizationToken: z.uuid(),
});
export const acquireShiftCustodySchema = z.object({ shiftId: z.uuid(), device: posDeviceCredentialSchema });
export const cashMovementSchema = z.object({
  shiftId: z.uuid(), movementType: z.enum(["PAY_IN", "PAY_OUT"]),
  amount: cashMovementAmountSchema, reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.uuid(), approvalRequestId: z.uuid().nullable().optional(),
});

export type OpenShiftSubmission = z.infer<typeof openShiftSubmissionSchema>;
export type MobileCloseShiftSubmission = z.infer<typeof mobileCloseShiftSchema>;
export type AcquireShiftCustodySubmission = z.infer<typeof acquireShiftCustodySchema>;
export type CashMovementSubmission = z.infer<typeof cashMovementSchema>;
export type MobileShiftCloseUpgradeRequired = PosClientUpgradeRequiredResponse;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function legacyMobileShiftCloseUpgrade(input: unknown): MobileShiftCloseUpgradeRequired | null {
  if (!record(input)) return null;
  const legacy = typeof input.shiftId === "string" && typeof input.countedCash === "string"
    && !("device" in input) && !("localHighWater" in input) && !("finalizationToken" in input);
  return legacy ? {
    ok: false, code: "POS_CLIENT_UPGRADE_REQUIRED", requiredCapability: MOBILE_SHIFT_CUSTODY_CAPABILITY,
    retryable: false, preservesRecovery: true,
    message: "Update TINDIO POS before closing this shift. The shift remains open and pending transactions are preserved.",
  } : null;
}

export function isMobileShiftCloseUpgradeRequired(value: unknown): value is MobileShiftCloseUpgradeRequired {
  return record(value) && value.code === "POS_CLIENT_UPGRADE_REQUIRED";
}
