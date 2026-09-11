import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 4 derives product totals from existing authorized store-level projections", async () => {
  const stockView = await source("src/features/inventory/inventory-stock-view.tsx");

  assert.match(stockView, /function buildStockRollups\(rows: InventoryStockRow\[\]\)/);
  assert.match(stockView, /const id = `\$\{row\.productId\}:\$\{row\.variantId \?\? "base"\}`/);
  assert.match(stockView, /existing\.totalQuantity \+= row\.quantity/);
  assert.match(stockView, /rollup\.rows\.some\(\(row\) => matchesStatus\(row, status\)\)/);
  assert.match(stockView, /Totals across \{storeCount\} authorized stores/);
  assert.match(stockView, /href=\{row\.detailHref\}/);
});

test("Phase 4 preserves shared store scope and stock-detail routing after the Stock & Restock split", async () => {
  const [inventoryPage, replenishmentPage] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/app/(back-office)/back-office/replenishment/page.tsx"),
  ]);

  assert.match(inventoryPage, /rawRequestedTab === "stock"/);
  assert.match(inventoryPage, /redirect\(`\/back-office\/replenishment\?\$\{query\.toString\(\)\}`\)/);
  assert.match(replenishmentPage, /const storeScope = resolveBackOfficeStoreScope\(context, parameters\)/);
  assert.match(replenishmentPage, /const authorizedStore = \(storeId: string\) => storeScope\.storeIds === null \|\| storeScope\.storeIds\.includes\(storeId\);/);
  assert.match(replenishmentPage, /const visibleStore = \(storeId: string\) => authorizedStore\(storeId\) &&/);
  assert.match(replenishmentPage, /const stockLevels = levels\.filter\(\(level\) => visibleStore\(level\.store_id\)\)/);
  assert.match(replenishmentPage, /stockPositionKey\(level\.store_id, level\.product_id, level\.variant_id\)/);
  assert.match(replenishmentPage, /const stockRowsByPosition = new Map<string, InventoryStockRow>/);
  assert.match(replenishmentPage, /multiStoreCount=\{stores\.filter\(\(store\) => visibleStore\(store\.id\)\)\.length\}/);
  assert.match(replenishmentPage, /const stockDetailHref/);
  assert.match(replenishmentPage, /query\.set\("detailProduct", productId\)/);
});

test("Phase 4 is a read-only presentation layer with no new database write path", async () => {
  const [inventoryPage, stockView] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-stock-view.tsx"),
  ]);

  assert.doesNotMatch(stockView, /use server|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(inventoryPage, /from\("inventory_levels"\)[\s\S]*\.update\(/);
  assert.match(stockView, /multiStoreCount > 1 \? <MultiStoreStockSummary/);
});
