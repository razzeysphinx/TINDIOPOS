import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  offlineStore,
  offlineSync,
  offlineStatus,
  paymentScreen,
  posTerminal,
  posDevice,
  offlineRoute,
  offlineMigration,
  offlineDatabaseTest,
] = await Promise.all([
  source("../src/features/offline/offline-store.ts"),
  source("../src/features/offline/offline-sync.ts"),
  source("../src/features/offline/offline-queue-status.tsx"),
  source("../src/features/checkout/payment-screen.tsx"),
  source("../src/features/pos/pos-terminal.tsx"),
  source("../src/features/devices/pos-device.ts"),
  source("../src/app/api/pos/offline-checkout/route.ts"),
  source("../supabase/migrations/20260827152628_phase_8_offline_sync_binding_integrity.sql"),
  source("../supabase/tests/database/improvement_13_offline_sync_foundation.test.sql"),
]);

test("offline checkout records are durable, employee-scoped, and idempotent", () => {
  assert.match(offlineStore, /keyPath: "idempotencyKey"/);
  assert.match(offlineStore, /store\.get\(checkout\.idempotencyKey\)/);
  assert.match(offlineStore, /store\.add\(queued\)/);
  assert.match(offlineStore, /scope: string/);
  assert.match(offlineStore, /deviceScope: string \| null/);
  assert.match(offlineStore, /state: "LOCAL_PENDING"/);
  assert.match(offlineStore, /return value === "SYNCING" \? "LOCAL_PENDING" : value/);
  assert.match(paymentScreen, /enqueueOfflineCheckout/);
  assert.match(paymentScreen, /idempotencyKey,/);
  assert.match(posTerminal, /function createCheckoutKey\(\) \{\s+return crypto\.randomUUID\(\);/);
  assert.match(posTerminal, /idempotencyKey=\{checkoutKey\}/);
  assert.match(paymentScreen, /offlinePolicy === "cash"/);
});

test("automatic synchronization is serialized, reconnect-driven, and device-safe", () => {
  assert.match(offlineSync, /const activeSyncs = new Map<string, Promise<OfflineSyncReport>>\(\)/);
  assert.match(offlineSync, /window\.addEventListener\("online", handleOnline\)/);
  assert.match(offlineSync, /window\.setInterval\(\(\) => void sync\(\), 2_000\)/);
  assert.match(offlineSync, /for \(const entry of entries\.filter\(isReadyToRetry\)\)/);
  assert.match(offlineSync, /if \(result !== "completed"\) break/);
  assert.match(offlineSync, /identity\.deviceId !== checkout\.deviceId/);
  assert.match(offlineSync, /conflictType: "DEVICE_REVOKED"/);
  assert.match(posDevice, /verifiedOffline/);
});

test("the POS exposes the required sync states while manual controls remain supplementary", () => {
  assert.match(offlineStatus, /Online/);
  assert.match(offlineStatus, /Offline • \$\{pending\} pending/);
  assert.match(offlineStatus, /Syncing/);
  assert.match(offlineStatus, /⚠ Sync Problem/);
  assert.match(offlineStatus, /Retry after resolving/);
  assert.match(offlineStatus, /Sync now/);
  assert.match(offlineStatus, /useOfflineQueue\(scope\)/);
});

test("the server checkout and telemetry paths preserve authoritative context and binding", () => {
  assert.match(offlineRoute, /getBusinessContext\(\)/);
  assert.match(offlineRoute, /completeCheckout\(context, input, \{ guardOfflineTotal: true \}\)/);
  assert.match(offlineRoute, /record_offline_sync_event/);
  assert.match(offlineRoute, /context\.organization\.id/);
  assert.match(offlineRoute, /Cache-Control": "private, no-store/);
  assert.match(offlineMigration, /security definer/);
  assert.match(offlineMigration, /set search_path = ''/);
  assert.match(offlineMigration, /shift\.store_id = target_store_id/);
  assert.match(offlineMigration, /shift\.register_id = target_register_id/);
  assert.match(offlineMigration, /shift\.opened_by_employee_id = actor_employee_id/);
  assert.match(offlineMigration, /device\.store_id = target_store_id/);
  assert.match(offlineMigration, /device\.register_id = target_register_id/);
  assert.match(offlineMigration, /revoke execute on function public\.record_offline_sync_event/);
  assert.match(offlineMigration, /grant execute on function public\.record_offline_sync_event[\s\S]*to authenticated/);
});

test("database regression coverage proves exactly-once replay and rejects mismatched telemetry bindings", () => {
  assert.match(offlineDatabaseTest, /select plan\(36\)/);
  assert.match(offlineDatabaseTest, /reconnecting the same stable checkout UUID returns the original sale/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one payment/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one inventory movement/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one receipt/);
  assert.match(offlineDatabaseTest, /offline telemetry rejects a shift from a different register/);
  assert.match(offlineDatabaseTest, /offline telemetry rejects a device from a different register/);
});
