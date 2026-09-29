import type { PosDeviceCredential } from "../../../../../src/contracts/pos";
import type { CheckoutSaleActionResult } from "../../../../../src/features/checkout/checkout-types";
import {
  listPendingOutboxEvents,
  recoverInterruptedOutboxEvents,
  updateOutboxEvent,
} from "../../db/outbox";
import { getDeviceSyncState, recordServerCheckpoint } from "../../db/device-sync-state";
import { TindioApiError, requestPosV2Raw } from "../../lib/tindio-api";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { nextOutboxRetryAt } from "./retry-policy";
import type { DurableOutboxEvent, OutboxSummary } from "./outbox-types";
import { getOutboxSummary } from "../../db/outbox";
import { refreshDeviceCheckpoint } from "./checkpoint-sync";
import { pushPosV2SyncBatch } from "../../lib/tindio-api";

export type OutboxSyncReport = OutboxSummary & { completed: number; recovered: number };

const activeSyncs = new Map<string, Promise<OutboxSyncReport>>();

export async function syncPosV2OfflineCheckout(
  organizationId: string,
  event: DurableOutboxEvent,
  credential: PosDeviceCredential,
) {
  return requestPosV2Raw("/api/pos/v2/offline-checkout", {
    organizationId,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checkout: event.payload.checkout, device: credential, offline: { ...event.payload.offline, deviceSequence: event.deviceSequence } }),
    },
  });
}

function retryMessage() {
  return "Waiting for a secure TINDIO connection before this saved sale can sync.";
}

function isCheckoutFailure(result: CheckoutSaleActionResult | null): result is Extract<CheckoutSaleActionResult, { ok: false }> {
  return result !== null && !result.ok;
}

function checkpointFromResult(result: CheckoutSaleActionResult | null) {
  const sync = result && "sync" in result ? result.sync : undefined;
  return sync && Number.isSafeInteger(sync.serverCheckpoint) ? sync : null;
}

async function markRetryable(event: DurableOutboxEvent, attempts: number, message: string) {
  await updateOutboxEvent(event.organizationId, event.eventId, {
    state: "LOCAL_PENDING", attempts, lastError: message, conflictType: null,
    nextRetryAt: nextOutboxRetryAt(attempts),
  });
}

async function syncOneEvent(organizationId: string, event: DurableOutboxEvent) {
  const attempts = event.attempts + 1;
  await updateOutboxEvent(event.organizationId, event.eventId, {
    state: "SYNCING", attempts, lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null, lastError: null, conflictType: null,
  });
  try {
    // The credential is deliberately loaded only here; it is never part of the SQLite event.
    const identity = await loadMobileDeviceIdentity(organizationId);
    if (!identity || !identity.binding || identity.credential.deviceId !== event.deviceId ||
        identity.binding.storeId !== event.storeId || identity.binding.registerId !== event.registerId) {
      await updateOutboxEvent(event.organizationId, event.eventId, {
        state: "CONFLICT", lastError: "The device credential or terminal binding that accepted this sale is unavailable.",
        conflictType: "DEVICE_BINDING_MISMATCH", nextRetryAt: null,
      });
      return "stopped" as const;
    }
    const response = await syncPosV2OfflineCheckout(organizationId, event, identity.credential);
    const result = await response.json().catch(() => null) as CheckoutSaleActionResult | null;
    const checkpoint = checkpointFromResult(result);
    if (checkpoint) await recordServerCheckpoint({ organizationId, deviceId: event.deviceId, serverCheckpoint: checkpoint.serverCheckpoint, status: checkpoint.status });
    if (response.ok && result?.ok) {
      await updateOutboxEvent(event.organizationId, event.eventId, {
        state: "SYNCED", lastError: null, conflictType: null, nextRetryAt: null,
        syncedAt: new Date().toISOString(), serverSaleId: result.data.saleId,
        officialReceiptNumber: result.data.receiptNumber,
      });
      return "completed" as const;
    }
    if (response.status >= 500 || (isCheckoutFailure(result) && result.retryable)) {
      await markRetryable(event, attempts, isCheckoutFailure(result) ? result.message : retryMessage());
      return "stopped" as const;
    }
    const failureCode = isCheckoutFailure(result) ? result.failureCode : undefined;
    const sequenceFailure = ["SEQUENCE_GAP", "SEQUENCE_CONFLICT", "SEQUENCE_OUT_OF_ORDER"].includes(failureCode ?? "");
    await updateOutboxEvent(event.organizationId, event.eventId, {
      state: response.status === 401 || response.status === 403 ? "FAILED" : "CONFLICT",
      lastError: isCheckoutFailure(result) ? result.message : "This saved sale requires review before it can be posted.",
      conflictType: sequenceFailure ? failureCode! : response.status === 401 || response.status === 403 ? "AUTHORIZATION_CHANGED" : "SERVER_REJECTED",
      nextRetryAt: null,
    });
    return "stopped" as const;
  } catch (error) {
    if (error instanceof TindioApiError && (error.status === 401 || error.status === 403)) {
      await updateOutboxEvent(event.organizationId, event.eventId, {
        state: "FAILED", lastError: "Sign in again before TINDIO can sync this saved sale.",
        conflictType: "AUTHORIZATION_CHANGED", nextRetryAt: null,
      });
      return "stopped" as const;
    }
    await markRetryable(event, attempts, retryMessage());
    return "stopped" as const;
  }
}

async function synchronize(organizationId: string): Promise<OutboxSyncReport> {
  let identity: Awaited<ReturnType<typeof loadMobileDeviceIdentity>>;
  try {
    identity = await loadMobileDeviceIdentity(organizationId);
  } catch {
    return { ...(await getOutboxSummary(organizationId)), completed: 0, recovered: 0 };
  }
  if (!identity) return { ...(await getOutboxSummary(organizationId)), completed: 0, recovered: 0 };
  const deviceId = identity.credential.deviceId;
  const recovery = await recoverInterruptedOutboxEvents(organizationId, Date.now(), deviceId);
  const events = await listPendingOutboxEvents(organizationId, deviceId);
  let completed = 0;
  for (const event of events) {
    if (event.nextRetryAt !== null && event.nextRetryAt > new Date().toISOString()) break;
    let state = await getDeviceSyncState(organizationId, event.deviceId);
    if (state && event.deviceSequence > state.serverCheckpoint + 1) {
      let refreshed: Awaited<ReturnType<typeof refreshDeviceCheckpoint>>;
      try { refreshed = await refreshDeviceCheckpoint(organizationId); }
      catch { refreshed = { ok: false, reason: "CHECKPOINT_REFRESH_UNAVAILABLE" }; }
      if (!refreshed.ok) {
        await updateOutboxEvent(event.organizationId, event.eventId, { state: "LOCAL_PENDING", lastError: "Server checkpoint must be checked before this later sequence can sync.", nextRetryAt: nextOutboxRetryAt(event.attempts + 1) });
        break;
      }
      state = await getDeviceSyncState(organizationId, event.deviceId);
      if (!state || event.deviceSequence > state.serverCheckpoint + 1) {
        await updateOutboxEvent(event.organizationId, event.eventId, { state: "CONFLICT", conflictType: "LOCAL_SEQUENCE_GAP", lastError: "A required earlier device sequence is missing. This sale was not sent.", nextRetryAt: null });
        break;
      }
    }
    const result = await syncOneEvent(organizationId, event);
    if (result !== "completed") break;
    completed += 1;
  }
  return { ...(await getOutboxSummary(organizationId)), completed, recovered: recovery.changes };
}

/** A process-local lock makes each organization deliver only one FIFO event at a time. */
export function syncOutboxEvents(organizationId: string): Promise<OutboxSyncReport> {
  const active = activeSyncs.get(organizationId);
  if (active) return active;
  const sync = synchronize(organizationId);
  activeSyncs.set(organizationId, sync);
  void sync.finally(() => activeSyncs.delete(organizationId));
  return sync;
}

/** Phase 12 ordered batch delivery; ACKs are the only authority for local terminal states. */
export async function syncOutboxBatches(organizationId: string, maxBatches = 10) {
  const identity = await loadMobileDeviceIdentity(organizationId);
  if (!identity?.binding) return { completed: 0, batches: 0, stopped: true };
  let completed = 0; let batches = 0; let stopped = false;
  while (batches < maxBatches) {
    const events = (await listPendingOutboxEvents(organizationId, identity.credential.deviceId)).filter((event) => event.nextRetryAt === null || event.nextRetryAt <= new Date().toISOString()).slice(0, 20);
    if (!events.length) break;
    const response = await pushPosV2SyncBatch(organizationId, identity.credential, events.map((event) => ({ eventId: event.eventId, operationType: "SALE_COMPLETED", checkout: event.payload.checkout, offline: { ...event.payload.offline, deviceSequence: event.deviceSequence } })));
    batches += 1;
    for (const ack of response.acks) {
      const event = events.find((candidate) => candidate.eventId === ack.eventId); if (!event) { stopped = true; break; }
      if (ack.status === "SYNCED" && ack.result.ok) { await updateOutboxEvent(event.organizationId, event.eventId, { state: "SYNCED", syncedAt: new Date().toISOString(), nextRetryAt: null, lastError: null, conflictType: null, serverSaleId: ack.result.data.saleId, officialReceiptNumber: ack.result.data.receiptNumber }); completed += 1; continue; }
      if (ack.status === "RETRY") await markRetryable(event, event.attempts + 1, !ack.result.ok ? ack.result.message : retryMessage());
      else await updateOutboxEvent(event.organizationId, event.eventId, { state: ack.status === "FAILED" ? "FAILED" : "CONFLICT", nextRetryAt: null, lastError: !ack.result.ok ? ack.result.message : "Server did not acknowledge this saved sale.", conflictType: !ack.result.ok ? ack.result.failureCode ?? "SERVER_REJECTED" : "SERVER_REJECTED" });
      stopped = true; break;
    }
    if (stopped || response.stoppedEarly || response.acks.length < events.length) { stopped = true; break; }
  }
  return { completed, batches, stopped };
}
