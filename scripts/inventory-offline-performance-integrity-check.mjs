import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  offlineSync,
  checkoutService,
  catalogRoute,
  posContract,
  inventoryPage,
  offlineDatabaseTest,
] = await Promise.all([
  source("../src/features/offline/offline-sync.ts"),
  source("../src/features/checkout/checkout-service.ts"),
  source("../src/lib/auth/pos-v2-catalog.ts"),
  source("../src/contracts/pos.ts"),
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
  assert.match(checkoutService, /message:\s*result\.was_replayed/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one payment/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one inventory movement/);
  assert.match(offlineDatabaseTest, /automatic retry creates exactly one receipt/);
});

test("POS V2 catalogue loading stays bearer-authorized and page-bounded", () => {
  assert.match(catalogRoute, /getPosV2CatalogContext/);
  assert.match(catalogRoute, /authClient\.auth\.getClaims/);
  assert.match(
    catalogRoute,
    /posCatalogV2QuerySchema/,
    "POS catalogue resolver must consume the canonical V2 bounded query contract",
  );

  assert.match(
    posContract,
    /limit:[\s\S]*?\.max\(24\)/,
    "canonical POS catalogue contract must keep the page limit bounded at 24",
  );
  assert.match(catalogRoute, /target_offset:\s*parsedQuery\.data\.offset/);
  assert.match(catalogRoute, /target_limit:\s*parsedQuery\.data\.limit/);
  assert.match(catalogRoute, /hasMore:\s*payload\.hasMore/);
});

test("Inventory activity remains bounded and implements correct page look-ahead", () => {
  assert.match(inventoryPage, /const INVENTORY_ACTIVITY_PAGE_SIZE = 50;/);
  assert.match(inventoryPage, /const recentMovementsQuery\s*=\s*\["overview", "activity"\]\.includes\(activeTab\)/);
  assert.match(inventoryPage, /recentMovementsQuery\?\.range\(\s*activityPageOffset,\s*activityPageOffset \+ INVENTORY_ACTIVITY_PAGE_SIZE,\s*\);/);
  assert.match(inventoryPage, /recentMovementsQuery\?\.limit\(30\)/);
  assert.match(inventoryPage, /const movements = activeTab === "activity"\s*\?\s*loadedMovements\.slice\(0, INVENTORY_ACTIVITY_PAGE_SIZE\)/);
  assert.match(inventoryPage, /loadedMovements\.length > INVENTORY_ACTIVITY_PAGE_SIZE/);
  assert.match(inventoryPage, /const selectedDetailLevel\s*=\s*selectedDetailLevelId\s*\?/);
  assert.match(inventoryPage, /const selectedDetailPosition:\s*InventoryDetailPosition \| null\s*=\s*selectedDetailLevel/);
  assert.match(inventoryPage, /const detailActivityLimit = activeTab === "activity" \? 50 : 12;/);
  assert.match(inventoryPage, /const detailMovementsResult = selectedDetailPosition\s*\?\s*await loadInventoryItemActivity\(\{[\s\S]*?limit: detailActivityLimit/);
});
