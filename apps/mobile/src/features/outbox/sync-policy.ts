import type { PosSyncPushResponse } from "../../../../../src/contracts/pos";
import type { CheckoutSaleActionResult } from "../../../../../src/features/checkout/checkout-types";
import type { DurableOutboxEvent } from "./outbox-types";

type ExpectedAck = Pick<DurableOutboxEvent, "eventId" | "deviceSequence">;
type JsonRecord = Record<string, unknown>;

const ACK_STATUSES = new Set(["SYNCED", "RETRY", "CONFLICT", "FAILED"]);
const SYNC_STATUSES = new Set([
  "ACCEPTED",
  "REPLAY",
  "GAP",
  "DUPLICATE_SEQUENCE",
  "OUT_OF_ORDER",
  "IDEMPOTENCY_SEQUENCE_MISMATCH",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSync(value: unknown, deviceSequence: number) {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return value.deviceSequence === deviceSequence
    && Number.isSafeInteger(value.serverCheckpoint)
    && Number(value.serverCheckpoint) >= 0
    && Number.isSafeInteger(value.expectedSequence)
    && Number(value.expectedSequence) === Number(value.serverCheckpoint) + 1
    && typeof value.status === "string"
    && SYNC_STATUSES.has(value.status);
}

function validResult(value: unknown, status: string, deviceSequence: number) {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.message !== "string") {
    return false;
  }
  if (!validSync(value.sync, deviceSequence)) return false;

  if (status === "SYNCED") {
    if (value.ok !== true || !isRecord(value.data) || value.sync === undefined) return false;
    return typeof value.data.saleId === "string"
      && value.data.saleId.length > 0
      && Number.isSafeInteger(value.data.receiptNumber)
      && Number(value.data.receiptNumber) >= 1
      && isRecord(value.sync)
      && (value.sync.status === "ACCEPTED" || value.sync.status === "REPLAY")
      && Number(value.sync.serverCheckpoint) >= deviceSequence;
  }

  if (value.ok !== false || typeof value.retryable !== "boolean") return false;
  return status === "RETRY" ? value.retryable : !value.retryable;
}

function validHttpStatus(status: string, httpStatus: number) {
  if (status === "SYNCED") return httpStatus >= 200 && httpStatus < 300;
  if (status === "FAILED") return httpStatus === 401 || httpStatus === 403;
  if (status === "RETRY") {
    return httpStatus === 408
      || httpStatus === 425
      || httpStatus === 429
      || httpStatus >= 500;
  }
  return httpStatus >= 400
    && httpStatus < 500
    && httpStatus !== 401
    && httpStatus !== 403
    && httpStatus !== 429;
}

export function selectOrderedOutboxBatch(
  events: DurableOutboxEvent[],
  now: string,
  limit = 20,
) {
  const selected: DurableOutboxEvent[] = [];
  for (const event of events) {
    if (event.state !== "LOCAL_PENDING") break;
    if (event.nextRetryAt !== null && event.nextRetryAt > now) break;
    const previous = selected.at(-1);
    if (previous && event.deviceSequence !== previous.deviceSequence + 1) break;
    selected.push(event);
    if (selected.length >= limit) break;
  }
  return selected;
}

export function validateSyncPushResponse(
  value: unknown,
  organizationId: string,
  deviceId: string,
  expected: ExpectedAck[],
): PosSyncPushResponse | null {
  if (
    !isRecord(value)
    || value.ok !== true
    || value.version !== 1
    || value.organizationId !== organizationId
    || value.deviceId !== deviceId
    || typeof value.stoppedEarly !== "boolean"
    || !Array.isArray(value.acks)
    || value.acks.length === 0
    || value.acks.length > expected.length
  ) {
    return null;
  }

  let stopped = false;
  for (let index = 0; index < value.acks.length; index += 1) {
    const ack = value.acks[index];
    const target = expected[index];
    if (
      !isRecord(ack)
      || !target
      || ack.eventId !== target.eventId
      || ack.deviceSequence !== target.deviceSequence
      || typeof ack.status !== "string"
      || !ACK_STATUSES.has(ack.status)
      || !Number.isSafeInteger(ack.httpStatus)
      || Number(ack.httpStatus) < 100
      || Number(ack.httpStatus) > 599
      || !validHttpStatus(ack.status, Number(ack.httpStatus))
      || !validResult(ack.result, ack.status, target.deviceSequence)
      || (stopped && index > 0)
    ) {
      return null;
    }
    if (ack.status !== "SYNCED") {
      if (index !== value.acks.length - 1) return null;
      stopped = true;
    }
  }

  const stoppedEarly = stopped || value.acks.length < expected.length;
  if (value.stoppedEarly !== stoppedEarly) return null;
  if (!stopped && value.acks.length !== expected.length) return null;
  return value as unknown as PosSyncPushResponse;
}

export function checkoutResultSync(result: CheckoutSaleActionResult) {
  return result.sync ?? null;
}
