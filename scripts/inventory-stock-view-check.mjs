import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Stock view provides the Phase 2 operational controls and keeps the layout preference local", async () => {
  const stockView = await source("src/features/inventory/inventory-stock-view.tsx");

  assert.match(stockView, /^"use client";/);
  assert.match(stockView, /type InventoryStockLayout = "grid" \| "list";/);
  assert.match(stockView, /tindio-inventory-stock-layout:/);
  assert.match(stockView, /useSyncExternalStore<InventoryStockLayout>/);
  assert.match(stockView, /Search product, SKU, or barcode/);
  assert.match(stockView, /All categories/);
  assert.match(stockView, /Quantity high–low/);
  assert.match(stockView, /No grouping/);
  assert.match(stockView, /group === "category"/);
  assert.match(stockView, /group === "store"/);
  assert.match(stockView, /group === "status"/);
});

test("Stock status derives from the existing projection and optional replenishment threshold", async () => {
  const [stockView, stockStatus] = await Promise.all([
    source("src/features/inventory/inventory-stock-view.tsx"),
    source("src/features/inventory/inventory-stock-status.ts"),
  ]);

  assert.match(stockView, /getInventoryStockCondition\(\{ quantity: row\.quantity, reorderPoint: row\.reorderPoint \}\)/);
  assert.match(stockStatus, /if \(quantity < 0\) return "negative";/);
  assert.match(stockStatus, /if \(quantity === 0\) return "out_of_stock";/);
  assert.match(stockStatus, /reorderPoint !== null && quantity <= reorderPoint/);
  assert.match(stockView, /if \(status === "available"\) return row\.isAvailable;/);
  assert.match(stockView, /condition === "low" \|\| condition === "negative" \|\| condition === "out_of_stock"/);
});

test("Inventory page scopes selected-store stock queries and redacts financial fields without permission", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(inventoryPage, /const settingsQuery = supabase/);
  assert.match(inventoryPage, /const levelsQuery = supabase/);
  assert.match(inventoryPage, /const scopedStoreIds = selectedStoreId \? \[selectedStoreId\] : storeScope\.storeIds/);
  assert.match(inventoryPage, /settingsQuery\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /levelsQuery\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /replenishmentRulesQuery\?\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /averageCostMinor: canViewCosts\s+\? averageCostByStockLevel\.get/);
  assert.match(inventoryPage, /rpc\("get_inventory_valuation"/);
  assert.match(inventoryPage, /reorderPoint: canManage \? reorderPoints\.get/);
  assert.match(inventoryPage, /<InventoryStockView/);
  assert.match(inventoryPage, /href=\{inventoryTabHref\("stock", "attention"\)\}\s+label="Needs attention"/);
});
