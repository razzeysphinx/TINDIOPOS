import type {
  PosDeviceCredential,
  PosSyncPushAck,
} from "../../../../../src/contracts/pos";
import {
  getOutboxSummary,
  listUnresolvedOutboxEvents,
  markOutboxEventSynced,
  recoverInterruptedOutboxEvents,
  updateOutboxEvent,
} from "../../db/outbox";
import {
  getDeviceSyncState,
  recordServerCheckpoint,
} from "../../db/device-sync-state";
import {
  pushPosV2SyncBatch,
  TindioApiError,
} from "../../lib/tindio-api";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { recordRecoveryRun } from "../performance/performance-metrics";
import { refreshDeviceCheckpoint } from "./checkpoint-sync";
import { nextOutboxRetryAt } from "./retry-policy";
import { runOutboxSingleFlight } from "./single-flight";
import {
  checkoutResultSync,
  selectOrderedOutboxBatch,
  validateSyncPushResponse,
} from "./sync-policy";
import type {
  DurableOutboxEvent,
  OutboxSummary,
} from "./outbox-types";

export type OutboxSyncReport = OutboxSummary & {
  completed: number;
  recovered: number;
};

type CoordinatorReport = OutboxSyncReport & {
  batches: number;
  stopped: boolean;
};

const OUTBOX_BATCH_SIZE = 20;
const OUTBOX_MAX_BATCHES = 50;
const OUTBOX_TRANSPORT_TIMEOUT_MS = 15_000;

class OutboxTransportTimeoutError extends Error {
  constructor() {
    super("OUTBOX_TRANSPORT_TIMEOUT");
    this.name = "OutboxTransportTimeoutError";
  }
}

function retryMessage() {
  return "Waiting for a secure TINDIO connection before this saved sale can sync.";
}

function unverifiedAckMessage() {
  return "TINDIO returned an incomplete or mismatched acknowledgement. This saved sale remains queued with its original identity.";
}

async function markRetryable(
  event: DurableOutboxEvent,
  attempts: number,
  message: string,
  retryAfterMs = 0,
) {
  await updateOutboxEvent(event.organizationId, event.eventId, {
    state: "LOCAL_PENDING",
    attempts,
    lastError: message,
    conflictType: null,
    nextRetryAt: nextOutboxRetryAt(attempts, Date.now(), retryAfterMs),
  });
}

async function markBatchRetryable(
  events: DurableOutboxEvent[],
  message: string,
  retryAfterMs = 0,
) {
  for (const event of events) {
    await markRetryable(event, event.attempts + 1, message, retryAfterMs);
  }
}

async function releaseUnacknowledged(events: DurableOutboxEvent[]) {
  for (const event of events) {
    await updateOutboxEvent(event.organizationId, event.eventId, {
      state: "LOCAL_PENDING",
      nextRetryAt: null,
      lastError: "Waiting for the earlier device sequence to finish before delivery.",
      conflictType: null,
    });
  }
}

async function claimBatch(events: DurableOutboxEvent[]) {
  const attemptedAt = new Date().toISOString();
  for (const event of events) {
    await updateOutboxEvent(event.organizationId, event.eventId, {
      state: "SYNCING",
      attempts: event.attempts + 1,
      lastAttemptAt: attemptedAt,
      nextRetryAt: null,
      lastError: null,
      conflictType: null,
    });
  }
}

async function pushWithTimeout(
  organizationId: string,
  credential: PosDeviceCredential,
  events: DurableOutboxEvent[],
) {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new OutboxTransportTimeoutError());
    }, OUTBOX_TRANSPORT_TIMEOUT_MS);
  });

  try {
    return await Promise.race([
      pushPosV2SyncBatch(
        organizationId,
        credential,
        events.map((event) => ({
          eventId: event.eventId,
          operationType: "SALE_COMPLETED" as const,
          checkout: event.payload.checkout,
          offline: {
            ...event.payload.offline,
            deviceSequence: event.deviceSequence,
          },
        })),
        controller.signal,
      ),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function sequenceFailureCode(ack: PosSyncPushAck) {
  if (ack.result.ok) return null;
  return ["SEQUENCE_GAP", "SEQUENCE_CONFLICT", "SEQUENCE_OUT_OF_ORDER"]
    .includes(ack.result.failureCode ?? "")
    ? ack.result.failureCode ?? null
    : null;
}

async function applyAck(event: DurableOutboxEvent, ack: PosSyncPushAck) {
  const checkpoint = checkoutResultSync(ack.result);
  if (checkpoint) {
    await recordServerCheckpoint({
      organizationId: event.organizationId,
      deviceId: event.deviceId,
      serverCheckpoint: checkpoint.serverCheckpoint,
      status: checkpoint.status,
    });
  }

  if (ack.status === "SYNCED" && ack.result.ok) {
    await markOutboxEventSynced({
      organizationId: event.organizationId,
      eventId: event.eventId,
      syncedAt: new Date().toISOString(),
      serverSaleId: ack.result.data.saleId,
      officialReceiptNumber: ack.result.data.receiptNumber,
    });
    return "completed" as const;
  }

  if (ack.status === "RETRY" && !ack.result.ok) {
    await markRetryable(
      event,
      event.attempts + 1,
      ack.result.message,
    );
    return "stopped" as const;
  }

  const failureCode = sequenceFailureCode(ack);
  const reportedFailureCode = ack.result.ok ? null : ack.result.failureCode ?? null;
  await updateOutboxEvent(event.organizationId, event.eventId, {
    state: ack.status === "FAILED" ? "FAILED" : "CONFLICT",
    lastError: ack.result.ok
      ? "Server did not acknowledge this saved sale."
      : ack.result.message,
    conflictType: failureCode
      ?? reportedFailureCode
      ?? (ack.status === "FAILED" ? "AUTHORIZATION_CHANGED" : "SERVER_REJECTED"),
    nextRetryAt: null,
  });
  return "stopped" as const;
}

async function ensureFirstSequenceCanRun(
  organizationId: string,
  event: DurableOutboxEvent,
) {
  let state = await getDeviceSyncState(organizationId, event.deviceId);
  if (!state || event.deviceSequence <= state.serverCheckpoint + 1) return true;

  let refreshed: Awaited<ReturnType<typeof refreshDeviceCheckpoint>>;
  try {
    refreshed = await refreshDeviceCheckpoint(organizationId);
  } catch {
    refreshed = { ok: false, reason: "CHECKPOINT_REFRESH_UNAVAILABLE" };
  }
  if (!refreshed.ok) {
    await markRetryable(
      event,
      event.attempts + 1,
      "Server checkpoint must be checked before this later sequence can sync.",
    );
    return false;
  }

  state = await getDeviceSyncState(organizationId, event.deviceId);
  if (state && event.deviceSequence <= state.serverCheckpoint + 1) return true;

  await updateOutboxEvent(event.organizationId, event.eventId, {
    state: "CONFLICT",
    conflictType: "LOCAL_SEQUENCE_GAP",
    lastError: "A required earlier device sequence is missing. This sale was not sent.",
    nextRetryAt: null,
  });
  return false;
}

async function synchronize(
  organizationId: string,
  identity: NonNullable<Awaited<ReturnType<typeof loadMobileDeviceIdentity>>>,
  maxBatches: number,
): Promise<CoordinatorReport> {
  const deviceId = identity.credential.deviceId;
  const recoveryStartedAt = Date.now();
  const recovery = await recoverInterruptedOutboxEvents(organizationId, deviceId);
  recordRecoveryRun(Date.now() - recoveryStartedAt);

  let completed = 0;
  let batches = 0;
  let stopped = false;

  while (batches < maxBatches) {
    const unresolved = await listUnresolvedOutboxEvents(organizationId, deviceId);
    if (unresolved.length === 0) break;

    let events = selectOrderedOutboxBatch(
      unresolved,
      new Date().toISOString(),
      OUTBOX_BATCH_SIZE,
    );
    if (events.length === 0) {
      stopped = true;
      break;
    }

    const contextMismatch = events.findIndex((event) =>
      !identity.binding
      || identity.binding.storeId !== event.storeId
      || identity.binding.registerId !== event.registerId
    );
    if (contextMismatch === 0) {
      const event = events[0];
      await updateOutboxEvent(event.organizationId, event.eventId, {
        state: "CONFLICT",
        lastError: "The device credential or terminal binding that accepted this sale is unavailable.",
        conflictType: "DEVICE_BINDING_MISMATCH",
        nextRetryAt: null,
      });
      stopped = true;
      break;
    }
    if (contextMismatch > 0) events = events.slice(0, contextMismatch);

    if (!await ensureFirstSequenceCanRun(organizationId, events[0])) {
      stopped = true;
      break;
    }

    await claimBatch(events);
    batches += 1;

    let response: Awaited<ReturnType<typeof pushPosV2SyncBatch>>;
    try {
      response = await pushWithTimeout(
        organizationId,
        identity.credential,
        events,
      );
    } catch (error) {
      if (error instanceof TindioApiError && (error.status === 401 || error.status === 403)) {
        const [first, ...tail] = events;
        await updateOutboxEvent(first.organizationId, first.eventId, {
          state: "FAILED",
          lastError: "Sign in again before TINDIO can sync this saved sale.",
          conflictType: "AUTHORIZATION_CHANGED",
          nextRetryAt: null,
        });
        await releaseUnacknowledged(tail);
      } else if (
        error instanceof TindioApiError
        && error.status >= 400
        && error.status < 500
        && error.status !== 429
      ) {
        const [first, ...tail] = events;
        await updateOutboxEvent(first.organizationId, first.eventId, {
          state: "CONFLICT",
          lastError: "TINDIO rejected this saved event envelope. It requires review before later sequences can sync.",
          conflictType: "SERVER_REJECTED",
          nextRetryAt: null,
        });
        await releaseUnacknowledged(tail);
      } else {
        const retryAfterMs = error instanceof TindioApiError && error.status === 429
          ? error.retryAfterMs ?? 0
          : 0;
        await markBatchRetryable(events, retryMessage(), retryAfterMs);
      }
      stopped = true;
      break;
    }

    const validated = validateSyncPushResponse(
      response,
      organizationId,
      deviceId,
      events,
    );
    if (!validated) {
      await markBatchRetryable(events, unverifiedAckMessage());
      stopped = true;
      break;
    }

    for (let index = 0; index < validated.acks.length; index += 1) {
      const result = await applyAck(events[index], validated.acks[index]);
      if (result === "completed") completed += 1;
      else stopped = true;
    }
    await releaseUnacknowledged(events.slice(validated.acks.length));

    if (stopped || validated.stoppedEarly) {
      stopped = true;
      break;
    }
  }

  const summary = await getOutboxSummary(organizationId);
  return {
    ...summary,
    completed,
    recovered: recovery.changes,
    batches,
    stopped,
  };
}

async function coordinateOutboxSync(
  organizationId: string,
  maxBatches = OUTBOX_MAX_BATCHES,
): Promise<CoordinatorReport> {
  let identity: Awaited<ReturnType<typeof loadMobileDeviceIdentity>>;
  try {
    identity = await loadMobileDeviceIdentity(organizationId);
  } catch {
    return {
      ...(await getOutboxSummary(organizationId)),
      completed: 0,
      recovered: 0,
      batches: 0,
      stopped: true,
    };
  }
  if (!identity?.binding) {
    return {
      ...(await getOutboxSummary(organizationId)),
      completed: 0,
      recovered: 0,
      batches: 0,
      stopped: true,
    };
  }

  const deviceScope = `${organizationId}:${identity.credential.deviceId}`;
  return runOutboxSingleFlight(deviceScope, () =>
    synchronize(
      organizationId,
      identity,
      Math.max(1, Math.min(OUTBOX_MAX_BATCHES, maxBatches)),
    )
  );
}

/** Every automatic, manual, single, and batch trigger joins this device-scoped coordinator. */
export function syncOutboxEvents(organizationId: string): Promise<OutboxSyncReport> {
  return coordinateOutboxSync(organizationId);
}

export async function syncOutboxBatches(
  organizationId: string,
  maxBatches = OUTBOX_MAX_BATCHES,
) {
  const report = await coordinateOutboxSync(organizationId, maxBatches);
  return {
    completed: report.completed,
    batches: report.batches,
    stopped: report.stopped,
  };
}
