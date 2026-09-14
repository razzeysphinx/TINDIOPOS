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

test("Stock status presentation reuses the shared condition helper while filtering stays server-side", async () => {
  const [stockView, stockStatus, stockPageMigration] = await Promise.all([
    source("src/features/inventory/inventory-stock-view.tsx"),
    source("src/features/inventory/inventory-stock-status.ts"),
    source("supabase/migrations/20260911140000_inventory_stock_page_performance.sql"),
  ]);

  assert.match(stockView, /getInventoryStockCondition\(\{ quantity: row\.quantity, reorderPoint: row\.reorderPoint \}\)/);
  assert.match(stockStatus, /if \(quantity < 0\) return "negative";/);
  assert.match(stockStatus, /if \(quantity === 0\) return "out_of_stock";/);
  assert.match(stockStatus, /reorderPoint !== null && quantity <= reorderPoint/);
  assert.match(stockPageMigration, /normalized_status = 'available' and is_available/);
  assert.match(stockPageMigration, /normalized_status = 'attention'/);
  assert.match(stockPageMigration, /requested_page_size integer default 50/);
});

test("Stock & Restock uses the centralized scoped read model and redacts costs at the data boundary", async () => {
  const [replenishmentPage, stockPageMigration] = await Promise.all([
    source("src/app/(back-office)/back-office/replenishment/page.tsx"),
    source("supabase/migrations/20260911140000_inventory_stock_page_performance.sql"),
  ]);

  assert.match(replenishmentPage, /supabase\.rpc\("get_inventory_stock_page"/);
  assert.match(replenishmentPage, /requested_store_id: storeScope\.selectedStoreId/);
  assert.match(replenishmentPage, /requested_page_size: stockPageSize/);
  assert.match(replenishmentPage, /supabase\.from\("product_store_settings"/);
  assert.match(replenishmentPage, /supabase\.from\("inventory_levels"/);
  assert.match(stockPageMigration, /private\.has_store_read_scope\(target_organization_id, requested_store_id\)/);
  assert.match(stockPageMigration, /private\.has_permission\(target_organization_id, 'products\.view_cost'\)/);
  assert.match(stockPageMigration, /case when can_read_cost then level\.average_cost_minor else null end as average_cost_minor/);
  assert.match(stockPageMigration, /preserves inventory_levels as the balance authority/);
  assert.match(stockPageMigration, /uninitialized_simple_positions as/);
  assert.match(stockPageMigration, /uninitialized_variant_positions as/);
  assert.match(replenishmentPage, /detailProduct/);
  assert.match(replenishmentPage, /<InventoryStockView/);
  assert.match(replenishmentPage, /workspace="restock"/);
});
