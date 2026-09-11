import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 3 product detail is a progressive-disclosure drawer with summary, stores, and activity", async () => {
  const detail = await source("src/features/inventory/inventory-product-detail.tsx");

  assert.match(detail, /^"use client";/);
  assert.match(detail, /<DialogContent side="right">/);
  assert.match(detail, />Summary</);
  assert.match(detail, />By store</);
  assert.match(detail, />Recent activity</);
  assert.match(detail, /Incoming purchase orders/);
  assert.match(detail, /Transfer inbound/);
  assert.match(detail, /Transfer outbound/);
  assert.match(detail, /Projected stock/);
  assert.match(detail, />Purchasing</);
  assert.match(detail, />View full activity</);
  assert.match(detail, />Adjust stock</);
  assert.match(detail, /router\.replace\(detail\.closeHref\)/);
  assert.match(detail, /quantityBefore/);
  assert.match(detail, /quantityAfter/);
  assert.match(detail, /referenceHref/);
});

test("Item activity is read from the existing ledger only after an authorized stock level is selected", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(inventoryPage, /const selectedDetailLevel = selectedDetailLevelId/);
  assert.match(inventoryPage, /if \(selectedDetailLevelId && !selectedDetailLevel\) notFound\(\);/);
  assert.match(inventoryPage, /const detailActivityLimit = activeTab === "activity" \? 50 : 12;/);
  assert.match(inventoryPage, /await loadInventoryItemActivity\(/);
  assert.match(inventoryPage, /\.eq\("store_id", storeId\)/);
  assert.match(inventoryPage, /\.eq\("product_id", productId\)/);
  assert.match(inventoryPage, /\.limit\(limit\)/);
  assert.match(inventoryPage, /hasPermission\(context, "receipts\.view"\)/);
  assert.match(inventoryPage, /<InventoryProductDetail detail=\{inventoryDetail\}/);
  assert.match(inventoryPage, /const selectedDetailPosition: InventoryDetailPosition/);
  assert.match(inventoryPage, /detailProduct/);
  assert.match(inventoryPage, /isAssignedToStore/);
  assert.match(inventoryPage, /outboundTransferQuantity/);
  assert.match(inventoryPage, /projectedQuantity:/);
});

test("Phase 3 preserves financial and employee-data boundaries", async () => {
  const [inventoryPage, detail] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-product-detail.tsx"),
  ]);

  assert.match(inventoryPage, /hasPermission\(context, "employees\.manage"\)/);
  assert.match(inventoryPage, /averageCostMinor: canViewCosts\s+\? averageCostByStockLevel\.get/);
  assert.match(inventoryPage, /rpc\("get_inventory_valuation"/);
  assert.doesNotMatch(detail, /averageCostMinor|unitCostMinor|valueDeltaMinor/);
  assert.match(inventoryPage, /source_type, source_id/);
});
