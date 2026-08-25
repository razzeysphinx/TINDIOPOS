"use client";

import { useCallback, useEffect, useState } from "react";

import type { CheckoutSaleActionResult } from "@/features/checkout/checkout-types";
import {
  getOfflineStorageHealth,
  getPosDeviceIdentity,
  listOfflineCheckouts,
  pruneSyncedOfflineCheckouts,
  subscribeToOfflineStore,
  updateOfflineCheckout,
  type OfflineCheckoutState,
  type OfflineConflictType,
  type OfflineQueuedCheckout,
  type OfflineStorageHealth,
} from "@/features/offline/offline-store";

export type OfflineQueueSummary = {
  pending: number;
  syncing: number;
  synced: number;
  conflict: number;
  failed: number;
};

export type OfflineSyncReport = OfflineQueueSummary & {
  completed: number;
};

const activeSyncs = new Map<string, Promise<OfflineSyncReport>>();

function isOnline() {
  return typeof navigator !== "undefined" && navigator.onLine;
}

function networkMessage() {
  return "Waiting for a secure TINDIO connection before this sale can sync.";
}

function syncSummary(entries: OfflineQueuedCheckout[]): OfflineQueueSummary {
  return {
    pending: entries.filter((entry) => ["DRAFT", "LOCAL_PENDING"].includes(entry.state)).length,
    syncing: entries.filter((entry) => entry.state === "SYNCING").length,
    synced: entries.filter((entry) => entry.state === "SYNCED").length,
    conflict: entries.filter((entry) => entry.state === "CONFLICT").length,
    failed: entries.filter((entry) => entry.state === "FAILED").length,
  };
}

function retryDelayMs(attempts: number) {
  const base = 1_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 3);
  return base + Math.floor(Math.random() * Math.max(250, base * 0.2));
}

function nextRetryAt(attempts: number) {
  return new Date(Date.now() + retryDelayMs(attempts)).toISOString();
}

function isReadyToRetry(entry: OfflineQueuedCheckout) {
  return entry.state === "LOCAL_PENDING" && (
    entry.nextRetryAt === null || new Date(entry.nextRetryAt).getTime() <= Date.now()
  );
}

function conflictType(result: CheckoutSaleActionResult | null): OfflineConflictType {
  if (result && !result.ok && result.failureCode) return result.failureCode;
  return "PERMISSION_CHANGED";
}

async function markTransientFailure(checkout: OfflineQueuedCheckout, message: string) {
  await updateOfflineCheckout(checkout.idempotencyKey, {
    lastError: message,
    conflictType: null,
    state: "LOCAL_PENDING",
    nextRetryAt: nextRetryAt(checkout.attempts + 1),
  });
}

async function syncOne(checkout: OfflineQueuedCheckout) {
  const attemptAt = new Date().toISOString();
  const attempts = checkout.attempts + 1;
  await updateOfflineCheckout(checkout.idempotencyKey, {
    attempts,
    lastAttemptAt: attemptAt,
    lastError: null,
    conflictType: null,
    nextRetryAt: null,
    state: "SYNCING",
  });

  try {
    let device: { deviceId: string; secret: string; appVersion: string } | null = null;
    if (checkout.deviceId) {
      const identity = checkout.deviceScope
        ? await getPosDeviceIdentity(checkout.deviceScope)
        : undefined;
      if (!identity || identity.deviceId !== checkout.deviceId) {
        await updateOfflineCheckout(checkout.idempotencyKey, {
          lastError: "The device credential that accepted this sale is unavailable. A manager must review it before retrying.",
          conflictType: "DEVICE_REVOKED",
          state: "CONFLICT",
        });
        return "conflict" as const;
      }
      device = {
        deviceId: identity.deviceId,
        secret: identity.secret,
        appVersion: identity.appVersion,
      };
    }

    const response = await fetch("/api/pos/offline-checkout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        checkout: checkout.payload,
        device,
        offline: {
          localReceiptReference: checkout.localReceiptReference,
          createdAt: checkout.createdAt,
          shiftId: checkout.snapshot.shift.id,
          deviceId: checkout.deviceId,
        },
      }),
    });
    const result = await response.json().catch(() => null) as CheckoutSaleActionResult | null;

    if (response.ok && result?.ok) {
      await updateOfflineCheckout(checkout.idempotencyKey, {
        state: "SYNCED",
        lastError: null,
        conflictType: null,
        nextRetryAt: null,
        syncedAt: new Date().toISOString(),
        officialReceiptNumber: result.data.receiptNumber,
        serverSaleId: result.data.saleId,
      });
      return "completed" as const;
    }

    if (response.status === 401) {
      await updateOfflineCheckout(checkout.idempotencyKey, {
        lastError: result && !result.ok
          ? result.message
          : "Sign in again before TINDIO can sync this saved sale.",
        conflictType: "PERMISSION_CHANGED",
        state: "FAILED",
      });
      return "failed" as const;
    }

    if (response.status >= 500 || (result !== null && !result.ok && result.retryable)) {
      await markTransientFailure(checkout, result && !result.ok ? result.message : networkMessage());
      return "pending" as const;
    }

    await updateOfflineCheckout(checkout.idempotencyKey, {
      lastError: result && !result.ok
        ? result.message
        : "This queued sale needs a manager to review it before it can be posted.",
      conflictType: conflictType(result),
      state: "CONFLICT",
      nextRetryAt: null,
    });
    return "conflict" as const;
  } catch {
    await markTransientFailure(checkout, networkMessage());
    return "pending" as const;
  }
}

export function syncOfflineCheckouts(scope: string): Promise<OfflineSyncReport> {
  const active = activeSyncs.get(scope);
  if (active) return active;

  const sync = (async () => {
    const entries = scope ? await listOfflineCheckouts(scope) : [];
    if (!scope || !isOnline()) {
      return { completed: 0, ...syncSummary(entries) };
    }

    let completed = 0;
    // A sale is sequenced by its durable local creation time. Stop on a
    // transient failure or conflict so later cash activity cannot overtake a
    // sale that depends on the same shift and inventory projection.
    for (const entry of entries.filter(isReadyToRetry)) {
      const result = await syncOne(entry);
      if (result === "completed") completed += 1;
      if (result !== "completed") break;
    }

    await pruneSyncedOfflineCheckouts(scope);
    const remaining = await listOfflineCheckouts(scope);
    return { completed, ...syncSummary(remaining) };
  })();

  activeSyncs.set(scope, sync);
  void sync.then(
    () => activeSyncs.delete(scope),
    () => activeSyncs.delete(scope),
  );
  return sync;
}

export function useOfflineQueue(scope: string) {
  const [summary, setSummary] = useState<OfflineQueueSummary>({
    pending: 0,
    syncing: 0,
    synced: 0,
    conflict: 0,
    failed: 0,
  });
  const [entries, setEntries] = useState<OfflineQueuedCheckout[]>([]);
  const [online, setOnline] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [storage, setStorage] = useState<OfflineStorageHealth>({
    usageBytes: null,
    quotaBytes: null,
    availableBytes: null,
    isLow: false,
  });

  const refresh = useCallback(async () => {
    if (!scope) return;
    const nextEntries = await listOfflineCheckouts(scope);
    setEntries(nextEntries);
    setSummary(syncSummary(nextEntries));
    setStorage(await getOfflineStorageHealth());
  }, [scope]);

  const sync = useCallback(async () => {
    if (!scope || !isOnline()) return;
    setIsSyncing(true);
    try {
      const report = await syncOfflineCheckouts(scope);
      setSummary(report);
      await refresh();
    } finally {
      setIsSyncing(false);
    }
  }, [refresh, scope]);

  useEffect(() => {
    const updateConnectivity = () => setOnline(isOnline());
    const handleOnline = () => {
      updateConnectivity();
      void sync();
    };

    updateConnectivity();
    const initialSync = window.setTimeout(() => {
      void refresh();
      if (isOnline()) void sync();
    }, 0);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", updateConnectivity);
    const unsubscribe = subscribeToOfflineStore(() => void refresh());
    const interval = window.setInterval(() => void sync(), 2_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", updateConnectivity);
      window.clearTimeout(initialSync);
      window.clearInterval(interval);
      unsubscribe();
    };
  }, [refresh, sync]);

  return { entries, isOnline: online, isSyncing, refresh, storage, summary, sync };
}

export function retryOfflineCheckout(idempotencyKey: string) {
  return updateOfflineCheckout(idempotencyKey, {
    lastError: null,
    conflictType: null,
    state: "LOCAL_PENDING",
    nextRetryAt: null,
  });
}

export function isOfflineTransactionPending(state: OfflineCheckoutState) {
  return state === "DRAFT" || state === "LOCAL_PENDING" || state === "SYNCING";
}
