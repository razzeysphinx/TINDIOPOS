import type { PosDeviceCredential } from "../../../../../src/contracts/pos";
import type { CheckoutSaleActionResult } from "../../../../../src/features/checkout/checkout-types";
import {
  listPendingOutboxEvents,
  recoverInterruptedOutboxEvents,
  updateOutboxEvent,
} from "../../db/outbox";
import { TindioApiError, requestPosV2Raw } from "../../lib/tindio-api";
import { loadMobileDeviceIdentity } from "../device/device-store";
import { nextOutboxRetryAt } from "./retry-policy";
import type { DurableOutboxEvent, OutboxSummary } from "./outbox-types";
import { getOutboxSummary } from "../../db/outbox";

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
      body: JSON.stringify({ checkout: event.payload.checkout, device: credential, offline: event.payload.offline }),
    },
  });
}

function retryMessage() {
  return "Waiting for a secure TINDIO connection before this saved sale can sync.";
}

function isCheckoutFailure(result: CheckoutSaleActionResult | null): result is Extract<CheckoutSaleActionResult, { ok: false }> {
  return result !== null && !result.ok;
}

async function markRetryable(event: DurableOutboxEvent, attempts: number, message: string) {
  await updateOutboxEvent(event.eventId, {
    state: "LOCAL_PENDING", attempts, lastError: message, conflictType: null,
    nextRetryAt: nextOutboxRetryAt(attempts),
  });
}

async function syncOneEvent(organizationId: string, event: DurableOutboxEvent) {
  const attempts = event.attempts + 1;
  await updateOutboxEvent(event.eventId, {
    state: "SYNCING", attempts, lastAttemptAt: new Date().toISOString(),
    nextRetryAt: null, lastError: null, conflictType: null,
  });
  try {
    // The credential is deliberately loaded only here; it is never part of the SQLite event.
    const identity = await loadMobileDeviceIdentity(organizationId);
    if (!identity || !identity.binding || identity.credential.deviceId !== event.deviceId ||
        identity.binding.storeId !== event.storeId || identity.binding.registerId !== event.registerId) {
      await updateOutboxEvent(event.eventId, {
        state: "CONFLICT", lastError: "The device credential or terminal binding that accepted this sale is unavailable.",
        conflictType: "DEVICE_BINDING_MISMATCH", nextRetryAt: null,
      });
      return "stopped" as const;
    }
    const response = await syncPosV2OfflineCheckout(organizationId, event, identity.credential);
    const result = await response.json().catch(() => null) as CheckoutSaleActionResult | null;
    if (response.ok && result?.ok) {
      await updateOutboxEvent(event.eventId, {
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
    await updateOutboxEvent(event.eventId, {
      state: response.status === 401 || response.status === 403 ? "FAILED" : "CONFLICT",
      lastError: isCheckoutFailure(result) ? result.message : "This saved sale requires review before it can be posted.",
      conflictType: response.status === 401 || response.status === 403 ? "AUTHORIZATION_CHANGED" : "SERVER_REJECTED",
      nextRetryAt: null,
    });
    return "stopped" as const;
  } catch (error) {
    if (error instanceof TindioApiError && (error.status === 401 || error.status === 403)) {
      await updateOutboxEvent(event.eventId, {
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
  const recovery = await recoverInterruptedOutboxEvents(organizationId);
  const events = await listPendingOutboxEvents(organizationId);
  let completed = 0;
  for (const event of events) {
    if (event.nextRetryAt !== null && event.nextRetryAt > new Date().toISOString()) break;
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
