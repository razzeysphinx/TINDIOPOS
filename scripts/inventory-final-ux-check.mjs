import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [inventoryPage, stockView, productDetail, storeScope] = await Promise.all([
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../src/features/inventory/inventory-stock-view.tsx"),
  source("../src/features/inventory/inventory-product-detail.tsx"),
  source("../src/lib/server/back-office-store-scope.ts"),
]);

test("Phase 10 keeps Inventory understandable, responsive, and keyboard-addressable", () => {
  assert.match(inventoryPage, /aria-label="Inventory sections" className="overflow-x-auto border-b"/);
  assert.match(inventoryPage, /Use Stock for current balances, Activity for recent changes/);
  assert.match(inventoryPage, /Needs attention/);
  assert.match(stockView, /aria-label="List view"/);
  assert.match(stockView, /aria-label="Grid view"/);
  assert.match(stockView, /<div className="space-y-3 lg:hidden">/);
  assert.match(stockView, /<Card className="hidden lg:block">/);
  assert.match(stockView, /No stock levels yet/);
  assert.match(stockView, /No stock matches these filters/);
  assert.match(productDetail, /<DialogContent side="right">/);
  assert.match(productDetail, /No inventory activity has been recorded for this item yet\./);
  assert.match(productDetail, /View full activity/);
});

test("Phase 10 applies employee store assignments before Inventory data is displayed", () => {
  assert.match(storeScope, /stores\.manage.*organization-wide authority/s);
  assert.match(storeScope, /storeIds: canAccessAllStores \? null : assignedStoreIds/);
  assert.match(inventoryPage, /const scopedStoreIds = selectedStoreId \? \[selectedStoreId\] : storeScope\.storeIds/);
  assert.match(inventoryPage, /settingsQuery\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /levelsQuery\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /recentMovementsQuery\?\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /inventoryCountsQuery\?\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /purchaseOrdersQuery\?\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /inventoryPoliciesQuery\?\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /const visibleStore = \(storeId: string\) => scopedStoreIds === null \|\| scopedStoreIds\.includes\(storeId\)/);
});

test("the final UI preserves bounded inventory activity and cost visibility", () => {
  assert.match(inventoryPage, /\.limit\(30\)/);
  assert.match(inventoryPage, /const detailActivityLimit = activeTab === "activity" \? 50 : 12/);
  assert.match(inventoryPage, /hasPermission\(context, "products\.view_cost"\)/);
  assert.match(stockView, /\{canViewCosts \? <th/);
  assert.match(stockView, /\{canViewCosts && row\.averageCostMinor !== null/);
});
