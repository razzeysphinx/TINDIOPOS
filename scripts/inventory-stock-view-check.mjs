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
  const stockView = await source("src/features/inventory/inventory-stock-view.tsx");

  assert.match(stockView, /if \(row\.quantity < 0\) return "negative";/);
  assert.match(stockView, /if \(row\.quantity === 0\) return "out_of_stock";/);
  assert.match(stockView, /row\.reorderPoint !== null && row\.quantity <= row\.reorderPoint/);
  assert.match(stockView, /if \(status === "available"\) return row\.isAvailable;/);
  assert.match(stockView, /condition === "low" \|\| condition === "negative" \|\| condition === "out_of_stock"/);
});

test("Inventory page scopes selected-store stock queries and redacts financial fields without permission", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(inventoryPage, /const settingsQuery = supabase/);
  assert.match(inventoryPage, /const levelsQuery = supabase/);
  assert.match(inventoryPage, /settingsQuery\.eq\("store_id", selectedStoreId\)/);
  assert.match(inventoryPage, /levelsQuery\.eq\("store_id", selectedStoreId\)/);
  assert.match(inventoryPage, /replenishmentRulesQuery\?\.eq\("store_id", selectedStoreId\)/);
  assert.match(inventoryPage, /averageCostMinor: canViewCosts \? Number\(level\.average_cost_minor\) : null/);
  assert.match(inventoryPage, /reorderPoint: canManage \? reorderPoints\.get/);
  assert.match(inventoryPage, /<InventoryStockView/);
  assert.match(inventoryPage, /href=\{inventoryTabHref\("stock", "attention"\)\}\s+label="Needs attention"/);
});
