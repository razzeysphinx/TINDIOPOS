import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [stockPageMigration, stockView, replenishmentPage, inventoryPage] = await Promise.all([
  source("../supabase/migrations/20260911140000_inventory_stock_page_performance.sql"),
  source("../src/features/inventory/inventory-stock-view.tsx"),
  source("../src/app/(back-office)/back-office/replenishment/page.tsx"),
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
]);

test("Stock & Restock uses a bounded, permission-checked page read model", () => {
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
});

test("Inventory Control bounds non-overview data to the active workspace", () => {
  assert.match(inventoryPage, /recentMovementsQuery\?\.range\(activityPageOffset, activityPageOffset \+ INVENTORY_ACTIVITY_PAGE_SIZE - 1\)/);
  assert.match(inventoryPage, /const countAwarenessQuery = workspace === "control" && activeTab === "overview"/);
  assert.match(inventoryPage, /\.in\("inventory_count_batch_id", inventoryCountBatchIds\)/);
  assert.match(inventoryPage, /\.in\("stock_transfer_id", openStockTransferIds\)/);
  assert.doesNotMatch(inventoryPage, /inventoryCountBatchDocumentsQuery/);
});

test("the stock list keeps responsive cards, contained tables, and keyboard focus", () => {
  assert.match(stockView, /<div className="space-y-3 lg:hidden">/);
  assert.match(stockView, /<Card className="hidden lg:block">/);
  assert.match(stockView, /overflow-x-auto overscroll-x-contain/);
  assert.match(stockView, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(stockView, /aria-busy=\{isNavigating\}/);
});
