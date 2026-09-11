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
  assert.match(stockView, />Store</);
  assert.match(stockView, /All stores/);
  assert.match(stockView, /Restock policy/);
  assert.match(stockView, /Do not restock/);
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

test("Stock & Restock scopes selected-store stock queries and redacts financial fields without permission", async () => {
  const replenishmentPage = await source("src/app/(back-office)/back-office/replenishment/page.tsx");

  assert.match(replenishmentPage, /const authorizedStore = \(storeId: string\) => storeScope\.storeIds === null \|\| storeScope\.storeIds\.includes\(storeId\);/);
  assert.match(replenishmentPage, /const visibleStore = \(storeId: string\) => authorizedStore\(storeId\) &&/);
  assert.match(replenishmentPage, /supabase\.from\("product_store_settings"/);
  assert.match(replenishmentPage, /supabase\.from\("inventory_levels"/);
  assert.match(replenishmentPage, /canViewCosts \? supabase\.rpc\("get_inventory_valuation"/);
  assert.match(replenishmentPage, /averageCostMinor: canViewCosts/);
  assert.match(replenishmentPage, /Inventory levels are the canonical projection/);
  assert.match(replenishmentPage, /quantity: 0,/);
  assert.match(replenishmentPage, /id: levelId \?\? `uninitialized:/);
  assert.match(replenishmentPage, /detailProduct/);
  assert.match(replenishmentPage, /stores=\{stores\.filter/);
  assert.match(replenishmentPage, /<InventoryStockView/);
  assert.match(replenishmentPage, /workspace="restock"/);
});
