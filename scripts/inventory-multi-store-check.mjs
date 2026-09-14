import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 4 derives loaded-page product totals from authorized store-level projections", async () => {
  const stockView = await source("src/features/inventory/inventory-stock-view.tsx");

  assert.match(stockView, /function buildStockRollups\(rows: InventoryStockRow\[\]\)/);
  assert.match(stockView, /const id = `\$\{row\.productId\}:\$\{row\.variantId \?\? "base"\}`/);
  assert.match(stockView, /existing\.totalQuantity \+= row\.quantity/);
  assert.match(stockView, /const condition = stockCondition\(row\);/);
  assert.match(stockView, /Across stores on this page/);
  assert.match(stockView, /Compare the loaded records across \{storeCount\} authorized stores/);
  assert.match(stockView, /href=\{row\.detailHref\}/);
});

test("Phase 4 preserves shared store scope, bounded stock reads, and stock-detail routing after the Stock & Restock split", async () => {
  const [inventoryPage, replenishmentPage, stockPageMigration] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/app/(back-office)/back-office/replenishment/page.tsx"),
    source("supabase/migrations/20260911140000_inventory_stock_page_performance.sql"),
  ]);

  assert.match(inventoryPage, /rawRequestedTab === "stock"/);
  assert.match(inventoryPage, /redirect\(`\/back-office\/replenishment\?\$\{query\.toString\(\)\}`\)/);
  assert.match(replenishmentPage, /const storeScope = resolveBackOfficeStoreScope\(context, parameters\)/);
  assert.match(replenishmentPage, /const authorizedStore = \(storeId: string\) => storeScope\.storeIds === null \|\| storeScope\.storeIds\.includes\(storeId\);/);
  assert.match(replenishmentPage, /const visibleStore = \(storeId: string\) => authorizedStore\(storeId\) &&/);
  assert.match(replenishmentPage, /supabase\.rpc\("get_inventory_stock_page"/);
  assert.match(replenishmentPage, /requested_store_id: storeScope\.selectedStoreId/);
  assert.match(replenishmentPage, /const stockRows: InventoryStockRow\[\] = stockPageEntries\.map/);
  assert.match(replenishmentPage, /multiStoreCount=\{stores\.length\}/);
  assert.match(stockPageMigration, /private\.has_store_read_scope\(target_organization_id, store\.id\)/);
  assert.match(replenishmentPage, /function stockDetailHref/);
  assert.match(replenishmentPage, /query\.set\("detailProduct", productId\)/);
});

test("Phase 4 remains a read-only presentation layer with no new database write path", async () => {
  const [inventoryPage, stockView, stockPageMigration] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-stock-view.tsx"),
    source("supabase/migrations/20260911140000_inventory_stock_page_performance.sql"),
  ]);

  assert.doesNotMatch(stockView, /use server|supabase/);
  assert.doesNotMatch(inventoryPage, /from\("inventory_levels"\)[\s\S]*\.update\(/);
  assert.doesNotMatch(stockPageMigration, /\binsert into\b|\bupdate public\.|\bdelete from\b/i);
  assert.match(stockView, /multiStoreCount > 1 \? <MultiStoreStockSummary/);
});
