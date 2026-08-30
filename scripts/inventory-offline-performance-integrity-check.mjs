import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  offlineSync,
  checkoutService,
  catalogRoute,
  inventoryPage,
  offlineDatabaseTest,
] = await Promise.all([
  source("../src/features/offline/offline-sync.ts"),
  source("../src/features/checkout/checkout-service.ts"),
  source("../src/app/api/pos/catalog/route.ts"),
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../supabase/tests/database/improvement_13_offline_sync_foundation.test.sql"),
]);

test("Phase 9 prevents duplicate cross-tab offline delivery attempts", () => {
  assert.match(offlineSync, /function withOfflineSyncLock<T>\(scope: string, work: \(\) => Promise<T>\): Promise<T>/);
  assert.match(offlineSync, /request<Promise<T>>\(`tindio-offline-sync:\$\{scope\}`, \{ mode: "exclusive" \}, \(\) => work\(\)\)/);
  assert.match(offlineSync, /const sync = withOfflineSyncLock\(scope, async \(\) =>/);
  assert.match(offlineSync, /const activeSyncs = new Map<string, Promise<OfflineSyncReport>>\(\)/);
  assert.match(offlineSync, /for \(const entry of entries\.filter\(isReadyToRetry\)\)/);
  assert.match(offlineSync, /if \(result !== "completed"\) break/);
});

test("the authoritative checkout still supplies exactly-once replay protection", () => {
  assert.match(checkoutService, /rpc\("checkout_advanced_sale"/);
  assert.match(checkoutService, /target_idempotency_key: data\.idempotencyKey/);
  assert.match(checkoutService, /message: result\.was_replayed/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one payment/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one inventory movement/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one receipt/);
});

test("POS catalogue loading stays server-authorized and page-bounded", () => {
  assert.match(catalogRoute, /hasPermission\(context, "pos\.access"\)/);
  assert.match(catalogRoute, /hasPermission\(context, "sales\.create"\)/);
  assert.match(catalogRoute, /max\(24\)/);
  assert.match(catalogRoute, /target_offset: parsed\.data\.offset/);
  assert.match(catalogRoute, /target_limit: parsed\.data\.limit/);
  assert.match(catalogRoute, /hasMore: items\.length === parsed\.data\.limit/);
});

test("Inventory activity stays lazy and bounded instead of loading full history", () => {
  assert.match(inventoryPage, /const recentMovementsQuery = activeTab === "activity"/);
  assert.match(inventoryPage, /\.limit\(30\)/);
  assert.match(inventoryPage, /const selectedDetailLevel = selectedDetailLevelId/);
  assert.match(inventoryPage, /const detailActivityLimit = activeTab === "activity" \? 50 : 12/);
  assert.match(inventoryPage, /selectedDetailLevel\n    \? await loadInventoryItemActivity/);
  assert.match(inventoryPage, /limit: detailActivityLimit/);
});
