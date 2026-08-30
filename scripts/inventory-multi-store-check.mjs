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

test("Phase 4 preserves the shared store scope and store-specific detail route", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(inventoryPage, /const storeScope = resolveBackOfficeStoreScope\(context, parameters\)/);
  assert.match(inventoryPage, /const scopedStoreIds = selectedStoreId \? \[selectedStoreId\] : storeScope\.storeIds/);
  assert.match(inventoryPage, /levelsQuery\.in\("store_id", scopedStoreIds\)/);
  assert.match(inventoryPage, /productId: level\.product_id/);
  assert.match(inventoryPage, /variantId: level\.variant_id/);
  assert.match(inventoryPage, /multiStoreCount=\{stores\.length\}/);
  assert.match(inventoryPage, /detailHref: inventoryDetailHref\("stock", level\.id\)/);
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
