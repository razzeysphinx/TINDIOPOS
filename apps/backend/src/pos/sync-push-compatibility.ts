import {
  POS_SYNC_PUSH_BATCH_MESSAGE,
  POS_SYNC_PUSH_DEVICE_MESSAGE,
  POS_SYNC_PUSH_DEVICE_RPC,
  POS_SYNC_PUSH_INVALID_MESSAGE,
  POS_SYNC_PUSH_MAX_EVENTS,
  POS_SYNC_PUSH_OPERATION,
  POS_SYNC_PUSH_PATH,
  POS_SYNC_PUSH_UNAVAILABLE_MESSAGE,
  POS_SYNC_PUSH_VERSION,
  posSyncPushRequestSchema,
  type PosSyncPushAck,
  type PosSyncPushRequestInput,
  type PosSyncPushResponse,
} from "@tindio/contracts/sync-push";
import type { CheckoutSaleActionResult } from "@tindio/contracts/checkout";

export const SYNC_PUSH_COMPATIBILITY_CONTRACT = {
  method: "POST",
  path: POS_SYNC_PUSH_PATH,
  authentication: "supabase-business-context-before-json",
  organizationScope: "selected-header-or-authorized-default",
  requestOrder: "business-context-before-json-before-device-before-events",
  operationType: POS_SYNC_PUSH_OPERATION,
  maximumEvents: POS_SYNC_PUSH_MAX_EVENTS,
  batchIdentity: [
    "one-device",
    "strictly-ascending-positive-device-sequence",
    "unique-event-id",
    "unique-checkout-idempotency-key",
  ],
  deviceRpc: POS_SYNC_PUSH_DEVICE_RPC,
  deviceCustody: "authenticated-employee-sales-permission-and-assigned-device-store",
  eventProcessor: "frozen-offline-checkout-processor",
  eventOrder: "request-order",
  stopCondition: "first-non-SYNCED-ack",
  ackStatuses: ["SYNCED", "RETRY", "CONFLICT", "FAILED"],
  responseVersion: POS_SYNC_PUSH_VERSION,
  actionResponses: {
    successEnvelope: 200,
    malformedOrInvalidBatch: 400,
    deviceRejected: 403,
    unavailable: 503,
    headers: { "cache-control": "private, no-store" },
  },
  messages: {
    invalid: POS_SYNC_PUSH_INVALID_MESSAGE,
    invalidBatch: POS_SYNC_PUSH_BATCH_MESSAGE,
    deviceRejected: POS_SYNC_PUSH_DEVICE_MESSAGE,
    unavailable: POS_SYNC_PUSH_UNAVAILABLE_MESSAGE,
  },
} as const;

type Rejection = {
  ok: false;
  status: 400;
  body: { ok: false; message: string };
};

export type SyncPushValidation =
  | { ok: true; input: PosSyncPushRequestInput }
  | Rejection;

export function validateSyncPushRequest(value: unknown): SyncPushValidation {
  const parsed = posSyncPushRequestSchema.safeParse(value);
  return parsed.success
    ? { ok: true, input: parsed.data }
    : {
        ok: false,
        status: 400,
        body: { ok: false, message: POS_SYNC_PUSH_INVALID_MESSAGE },
      };
}

function checkoutIdempotencyKey(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const key = (value as Record<string, unknown>).idempotencyKey;
  return typeof key === "string" ? key : "";
}

export function validateSyncPushBatch(input: PosSyncPushRequestInput): Rejection | null {
  const eventIds = new Set<string>();
  const idempotencyKeys = new Set<string>();
  let lastSequence = 0;

  for (const event of input.events) {
    const idempotencyKey = checkoutIdempotencyKey(event.checkout);
    if (
      event.offline.deviceId !== input.device.deviceId
      || event.offline.deviceSequence <= lastSequence
      || eventIds.has(event.eventId)
      || idempotencyKeys.has(idempotencyKey)
    ) {
      return {
        ok: false,
        status: 400,
        body: { ok: false, message: POS_SYNC_PUSH_BATCH_MESSAGE },
      };
    }
    eventIds.add(event.eventId);
    idempotencyKeys.add(idempotencyKey);
    lastSequence = event.offline.deviceSequence;
  }

  return null;
}

export function toSyncPushDeviceRpcArguments(
  organizationId: string,
  input: PosSyncPushRequestInput,
) {
  return {
    target_organization_id: organizationId,
    target_device_id: input.device.deviceId,
    target_secret: input.device.secret,
    target_app_version: input.device.appVersion,
  };
}

export type SyncPushDevice = {
  deviceId: string;
  storeId: string;
  registerId: string;
  deviceName: string;
  appVersion: string;
  lastSeenAt: string | null;
  status: string;
};

export function mapSyncPushDevice(
  value: unknown,
  error: unknown,
  expectedDeviceId: string,
  expectedAppVersion: string,
): SyncPushDevice | null {
  const row = Array.isArray(value) ? value[0] : null;
  if (error || !row || typeof row !== "object" || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (String(record.device_id) !== expectedDeviceId) return null;
  return {
    deviceId: expectedDeviceId,
    storeId: String(record.store_id),
    registerId: String(record.register_id),
    deviceName: String(record.name ?? "POS device"),
    appVersion: String(record.app_version ?? expectedAppVersion),
    lastSeenAt: record.last_seen_at ? String(record.last_seen_at) : null,
    status: String(record.status ?? "active"),
  };
}

export function toSyncPushOfflineSubmission(
  input: PosSyncPushRequestInput,
  event: PosSyncPushRequestInput["events"][number],
) {
  return { checkout: event.checkout, device: input.device, offline: event.offline };
}

export function createSyncPushAck(
  event: PosSyncPushRequestInput["events"][number],
  processed: { status: number; result: CheckoutSaleActionResult },
): PosSyncPushAck {
  const status = processed.result.ok
    ? "SYNCED"
    : processed.result.retryable
      ? "RETRY"
      : processed.status === 401 || processed.status === 403
        ? "FAILED"
        : "CONFLICT";
  return {
    eventId: event.eventId,
    deviceSequence: event.offline.deviceSequence,
    status,
    httpStatus: processed.status,
    result: processed.result,
  };
}

export function shouldStopSyncPush(ack: PosSyncPushAck): boolean {
  return ack.status !== "SYNCED";
}

export function createSyncPushResponse(
  organizationId: string,
  deviceId: string,
  acks: PosSyncPushAck[],
  stoppedEarly: boolean,
): PosSyncPushResponse {
  return {
    ok: true,
    version: POS_SYNC_PUSH_VERSION,
    organizationId,
    deviceId,
    acks,
    stoppedEarly,
  };
}
