import { z } from "zod";

export const POS_DEVICE_VALIDATION_PATH = "/api/pos/v2/device" as const;
export const POS_DEVICE_ENROLLMENT_PATH = "/api/pos/v2/device/enroll" as const;
export const POS_DEVICE_VALIDATION_RPC = "validate_pos_device" as const;
export const POS_DEVICE_ENROLLMENT_RPC = "register_pos_device" as const;
export const POS_DEVICE_ACCESS_PERMISSION = "pos.access" as const;
export const POS_DEVICE_MANAGEMENT_PERMISSION = "devices.manage" as const;

export const POS_DEVICE_ACCESS_MESSAGE = "POS access is not permitted." as const;
export const POS_DEVICE_INVALID_MESSAGE = "The POS device request is invalid." as const;
export const POS_DEVICE_REJECTED_MESSAGE = "This POS device is not active for your assigned store." as const;
export const POS_DEVICE_UNAVAILABLE_MESSAGE = "TINDIO could not verify this POS device." as const;
export const POS_DEVICE_MANAGEMENT_MESSAGE = "Device-management permission is required." as const;
export const POS_DEVICE_ENROLLMENT_INVALID_MESSAGE = "The device enrollment request is invalid." as const;
export const POS_DEVICE_ENROLLMENT_PERMISSION_MESSAGE = "You do not have permission to enroll this POS device." as const;
export const POS_DEVICE_ENROLLMENT_SCOPE_MESSAGE = "Choose a valid active store and register." as const;
export const POS_DEVICE_ENROLLMENT_DUPLICATE_MESSAGE = "This POS device is already registered." as const;
export const POS_DEVICE_ENROLLMENT_CONFIRMATION_MESSAGE = "TINDIO could not confirm the new POS device." as const;
export const POS_DEVICE_ENROLLMENT_UNAVAILABLE_MESSAGE = "TINDIO could not enroll this POS device." as const;

export const posDeviceCredentialSchema = z.object({
  deviceId: z.uuid(),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
  appVersion: z.string().trim().min(1).max(80),
});

export const registerPosDeviceSchema = z.object({
  storeId: z.uuid(),
  registerId: z.uuid(),
  deviceId: z.uuid(),
  name: z.string().trim().min(2).max(80),
  appVersion: z.string().trim().min(1).max(80),
  secret: z.string().regex(/^[0-9a-fA-F]{64}$/),
});

export const changePosDeviceRegisterSchema = z.object({
  deviceId: z.uuid(),
  storeId: z.uuid(),
  registerId: z.uuid(),
});

export const retirePosDeviceSchema = z.object({
  deviceId: z.uuid(),
  custodyDecision: z.enum(["RECONCILED", "DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS"]),
  reason: z.string().trim().min(10).max(500),
  lossConfirmation: z.string().optional(),
}).superRefine((value, context) => {
  if (
    value.custodyDecision === "DEVICE_UNAVAILABLE_ACCEPT_BOUNDED_LOSS"
    && value.lossConfirmation !== "ACCEPT LOCAL-ONLY TRANSACTION LOSS"
  ) {
    context.addIssue({
      code: "custom",
      message: "The bounded-loss confirmation does not match.",
      path: ["lossConfirmation"],
    });
  }
});

export const posDeviceValidationSchema = z.object({
  organizationId: z.uuid(),
  device: posDeviceCredentialSchema,
});

export type PosDeviceCredential = z.infer<typeof posDeviceCredentialSchema>;

export type PosDeviceBinding = {
  deviceId: string;
  storeId: string;
  registerId: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string;
};

export type PosDeviceValidationResponse =
  | { ok: true; device: PosDeviceBinding }
  | { ok: false; message: string };

export type PosDeviceDatabaseRow = {
  device_id: unknown;
  store_id: unknown;
  register_id: unknown;
  device_name?: unknown;
  name?: unknown;
  app_version?: unknown;
  last_seen_at?: unknown;
  status?: unknown;
};

export type PosDeviceSequenceStatus =
  | "ACCEPTED"
  | "REPLAY"
  | "GAP"
  | "DUPLICATE_SEQUENCE"
  | "OUT_OF_ORDER"
  | "IDEMPOTENCY_SEQUENCE_MISMATCH";

export type PosDeviceSyncCheckpoint = {
  deviceId: string;
  serverCheckpoint: number;
  nextExpectedSequence: number;
  updatedAt: string | null;
};

export type PosOfflineSequenceInfo = {
  deviceSequence: number;
  serverCheckpoint: number;
  expectedSequence: number;
  status: PosDeviceSequenceStatus;
};

export function posDeviceRequestHeaders(device: PosDeviceCredential | null | undefined) {
  if (!device) return undefined;

  return {
    "x-tindio-device-id": device.deviceId,
    "x-tindio-device-secret": device.secret,
    "x-tindio-app-version": device.appVersion,
  };
}
