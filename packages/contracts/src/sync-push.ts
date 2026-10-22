import { z } from "zod";

import type {
  CheckoutSaleActionResult,
  CheckoutSaleValues,
} from "@tindio/contracts/checkout";
import {
  posDeviceValidationSchema,
  type PosDeviceCredential,
} from "@tindio/contracts/device";

export const POS_SYNC_PUSH_PATH = "/api/pos/v2/sync/push" as const;
export const POS_SYNC_PUSH_DEVICE_RPC = "validate_pos_device" as const;
export const POS_SYNC_PUSH_OPERATION = "SALE_COMPLETED" as const;
export const POS_SYNC_PUSH_VERSION = 1 as const;
export const POS_SYNC_PUSH_MAX_EVENTS = 20 as const;

export const POS_SYNC_PUSH_INVALID_MESSAGE =
  "Invalid sync push request." as const;
export const POS_SYNC_PUSH_BATCH_MESSAGE =
  "The sync batch must contain unique ascending events for this device." as const;
export const POS_SYNC_PUSH_DEVICE_MESSAGE =
  "POS device validation failed." as const;
export const POS_SYNC_PUSH_UNAVAILABLE_MESSAGE =
  "TINDIO could not process this sync batch." as const;

export const posSyncPushEventSchema = z.object({
  eventId: z.uuid(),
  operationType: z.literal(POS_SYNC_PUSH_OPERATION),
  checkout: z.unknown(),
  offline: z.object({
    localReceiptReference: z.string().regex(/^OFF-[A-Z0-9]{6,32}$/),
    createdAt: z.iso.datetime(),
    shiftId: z.uuid(),
    deviceId: z.uuid(),
    deviceSequence: z.number().int().positive(),
  }),
});

export const posSyncPushRequestSchema = posDeviceValidationSchema.extend({
  events: z.array(posSyncPushEventSchema).min(1).max(POS_SYNC_PUSH_MAX_EVENTS),
});

export type PosSyncPushRequestInput = z.infer<typeof posSyncPushRequestSchema>;

export type PosSyncPushRequest = {
  organizationId: string;
  device: PosDeviceCredential;
  events: PosSyncPushEvent[];
};

export type PosSyncPushEvent = {
  eventId: string;
  operationType: "SALE_COMPLETED";
  checkout: CheckoutSaleValues;
  offline: {
    localReceiptReference: string;
    createdAt: string;
    shiftId: string;
    deviceId: string;
    deviceSequence: number;
  };
};

export type PosSyncPushAck = {
  eventId: string;
  deviceSequence: number;
  status: "SYNCED" | "RETRY" | "CONFLICT" | "FAILED";
  httpStatus: number;
  result: CheckoutSaleActionResult;
};

export type PosSyncPushResponse = {
  ok: true;
  version: 1;
  organizationId: string;
  deviceId: string;
  acks: PosSyncPushAck[];
  stoppedEarly: boolean;
};
