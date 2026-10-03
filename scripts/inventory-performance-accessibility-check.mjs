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
  replenishmentLoader,
  inventoryPage,
  inventoryCoreLoader,
  inventoryBundleMigration,
] =
  await Promise.all([
    source(
      "../archive/database/supabase-migrations/20260911140000_inventory_stock_page_performance.sql",
    ),

    source(
      "../archive/database/supabase-migrations/20260916100000_inventory_stock_page_lint_repair.sql",
    ),

    source(
      "../src/features/inventory/inventory-stock-view.tsx",
    ),

    source(
      "../src/app/(back-office)/back-office/replenishment/page.tsx",
    ),

    source(
      "../src/features/inventory/replenishment-data.ts",
    ),

    source(
      "../src/app/(back-office)/back-office/inventory/page.tsx",
    ),

    source(
      "../src/features/inventory/inventory-core-data.ts",
    ),

    source(
      "../database/migrations/0005_inventory_core_read_model_extension.sql",
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
    assert.match(replenishmentPage, /loadReplenishmentWorkspaceData/);
    assert.match(replenishmentLoader, /supabase\.rpc\("get_inventory_stock_page"/);
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
    assert.match(inventoryPage, /const activityLimit = activeTab === "activity" \? INVENTORY_ACTIVITY_PAGE_SIZE \+ 1 : 30/);
    assert.match(inventoryPage, /const activityOffset = activeTab === "activity" \? activityPageOffset : 0/);
    assert.match(inventoryPage, /loadInventoryControlCoreData\([\s\S]{0,1000}activityLimit,[\s\S]{0,160}activityOffset,/);
    assert.match(inventoryCoreLoader, /needs: coreNeeds,[\s\S]{0,360}activityLimit, activityOffset/);
    assert.match(inventoryBundleMigration, /least\(greatest\(coalesce\(requested_activity_limit, 30\), 1\), 101\)/);
    assert.match(inventoryBundleMigration, /v_activity_offset integer := greatest\(coalesce\(requested_activity_offset, 0\), 0\)/);
    assert.match(inventoryPage, /loadedMovements\.slice\(0, INVENTORY_ACTIVITY_PAGE_SIZE\)/);
    assert.match(inventoryPage, /loadedMovements\.length > INVENTORY_ACTIVITY_PAGE_SIZE/);
    assert.match(inventoryPage, /const countAwarenessQuery = workspace === "control" && activeTab === "overview"/);
    assert.match(inventoryPage, /get_inventory_count_batch_documents_workspace_v2/);
    assert.match(inventoryCoreLoader, /\["receivableStockTransfers", "stockTransferLines"\]/);
    assert.match(inventoryPage, /transferBundle\.stockTransferLines/);
    assert.doesNotMatch(inventoryPage, /from\("stock_transfer_lines"\)/);
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
