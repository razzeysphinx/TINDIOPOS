import assert from "node:assert/strict";

import {
  readFile,
} from "node:fs/promises";

import test from "node:test";

const source =
  (path) =>
    readFile(
      new URL(
        path,
        import.meta.url,
      ),
      "utf8",
    );

const [
  stockPageMigration,
  stockPageRepairMigration,
  stockView,
  replenishmentPage,
  inventoryPage,
] =
  await Promise.all([
    source(
      "../supabase/migrations/20260911140000_inventory_stock_page_performance.sql",
    ),

    source(
      "../supabase/migrations/20260916100000_inventory_stock_page_lint_repair.sql",
    ),

    source(
      "../src/features/inventory/inventory-stock-view.tsx",
    ),

    source(
      "../src/app/(back-office)/back-office/replenishment/page.tsx",
    ),

    source(
      "../src/app/(back-office)/back-office/inventory/page.tsx",
    ),
  ]);

test(
  "Stock & Restock uses a bounded, permission-checked page read model",
  () => {
    assert.match(stockPageMigration, /create or replace function public\.get_inventory_stock_page/);
    assert.match(stockPageMigration, /private\.has_any_inventory_capability/);
    assert.match(stockPageMigration, /private\.has_store_read_scope/);
    assert.match(stockPageMigration, /case when can_read_cost then level\.average_cost_minor else null end/);
    assert.match(stockPageMigration, /limit page_size\s+offset \(page_number - 1\) \* page_size/s);
    assert.match(stockPageMigration, /uninitialized_simple_positions/);
    assert.match(stockPageMigration, /uninitialized_variant_positions/);
    assert.match(replenishmentPage, /supabase\.rpc\("get_inventory_stock_page"/);
    assert.match(replenishmentPage, /const stockPageSize = 50/);
    assert.match(stockView, /router\.replace\(`\$\{pathname\}\?\$\{query\.toString\(\)\}`/);
    assert.match(stockView, /Page \{page\} of \{pageCount\}/);
    assert.match(stockView, /aria-label="Stock page navigation"/);
  },
);

test(
  "the forward stock-page repair qualifies PL/pgSQL collision fields",
  () => {
    assert.match(stockPageRepairMigration, /create or replace function public\.get_inventory_stock_page/);
    assert.match(stockPageRepairMigration, /count\(distinct metric_position\.product_id\) as active_product_count/);
    assert.match(stockPageRepairMigration, /normalized_status = 'available' and filter_position\.is_available/);
    assert.match(stockPageRepairMigration, /security definer/);
    assert.match(stockPageRepairMigration, /grant execute on function public\.get_inventory_stock_page[\s\S]*to authenticated;/);
  },
);

test(
  "Inventory Control fetches one activity lookahead row and renders only the page size",
  () => {
    assert.match(inventoryPage, /recentMovementsQuery\?\.range\(\s*activityPageOffset,\s*activityPageOffset \+ INVENTORY_ACTIVITY_PAGE_SIZE,\s*\)/s);
    assert.match(inventoryPage, /loadedMovements\.slice\(0, INVENTORY_ACTIVITY_PAGE_SIZE\)/);
    assert.match(inventoryPage, /loadedMovements\.length > INVENTORY_ACTIVITY_PAGE_SIZE/);
    assert.match(inventoryPage, /const countAwarenessQuery = workspace === "control" && activeTab === "overview"/);
    assert.match(inventoryPage, /\.in\("inventory_count_batch_id", inventoryCountBatchIds\)/);
    assert.match(inventoryPage, /\.in\("stock_transfer_id", openStockTransferIds\)/);
    assert.doesNotMatch(inventoryPage, /inventoryCountBatchDocumentsQuery/);
  },
);

test(
  "the stock list keeps responsive cards, contained tables, and keyboard focus",
  () => {
    assert.match(stockView, /<div className="space-y-3 lg:hidden">/);
    assert.match(stockView, /<Card className="hidden lg:block">/);
    assert.match(stockView, /overflow-x-auto overscroll-x-contain/);
    assert.match(stockView, /focus-visible:ring-2 focus-visible:ring-ring/);
    assert.match(stockView, /aria-busy=\{isNavigating\}/);
  },
);
