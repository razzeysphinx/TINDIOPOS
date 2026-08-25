import { z } from "zod";

import { posDeviceCredentialSchema } from "@/features/devices/device-schema";

const moneyInput = z
  .string()
  .trim()
  .regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter a valid non-negative amount.");

const optionalNote = z.string().trim().max(500).optional();

export const openShiftSchema = z.object({
  storeId: z.uuid(),
  registerId: z.uuid(),
  openingCash: moneyInput,
  openingNote: optionalNote,
});

export const openShiftSubmissionSchema = openShiftSchema.extend({
  device: posDeviceCredentialSchema.nullable().optional(),
});

export const closeShiftSchema = z.object({
  shiftId: z.uuid(),
  countedCash: moneyInput,
  closingNote: optionalNote,
});

export const cashMovementSchema = z.object({
  shiftId: z.uuid(),
  movementType: z.enum(["PAY_IN", "PAY_OUT"]),
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter a valid positive amount."),
  reason: z.string().trim().min(2).max(500),
  idempotencyKey: z.uuid(),
  approvalRequestId: z.uuid().nullable().optional(),
});
