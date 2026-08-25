import { z } from "zod";

export const TINDIO_POS_APP_VERSION = "web-0.1.0";

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

export const revokePosDeviceSchema = z.object({
  deviceId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});

export const posDeviceValidationSchema = z.object({
  organizationId: z.uuid(),
  device: posDeviceCredentialSchema,
});

export type PosDeviceCredential = z.infer<typeof posDeviceCredentialSchema>;

export function posDeviceRequestHeaders(device: PosDeviceCredential | null | undefined) {
  if (!device) return undefined;

  return {
    "x-tindio-device-id": device.deviceId,
    "x-tindio-device-secret": device.secret,
    "x-tindio-app-version": device.appVersion,
  };
}
