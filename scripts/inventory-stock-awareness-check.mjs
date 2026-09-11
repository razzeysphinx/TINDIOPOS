import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [stockView, replenishmentPage, catalogWorkspace, catalogService, catalogSchema, migration] = await Promise.all([
  source("../src/features/inventory/inventory-stock-view.tsx"),
  source("../src/app/(back-office)/back-office/replenishment/page.tsx"),
  source("../src/features/catalog/catalog-product-workspace.tsx"),
  source("../src/features/catalog/service.ts"),
  source("../src/features/catalog/catalog-schema.ts"),
  source("../supabase/migrations/20260905090000_inventory_stock_awareness_lifecycle.sql"),
]);

test("stock levels default to action priority and expose interactive summary filters", () => {
  assert.match(stockView, /InventoryStockSort = "priority"/);
  assert.match(stockView, /useState<InventoryStockSort>\("priority"\)/);
  assert.match(stockView, /condition === "negative"\) return 0/);
  assert.match(stockView, /condition === "low"\) return 1/);
  assert.match(stockView, /condition === "in_stock"\) return 2/);
  assert.match(stockView, /<StockSummary/);
  for (const label of ["Active products", "In stock", "Low stock", "Out of stock", "Negative stock", "Archived"]) {
    assert.match(stockView, new RegExp(label));
  }
  assert.match(stockView, /aria-pressed=\{status === metric\.target\}/);
  assert.match(stockView, /href="\/back-office\/catalog\?status=archived"/);
});

test("restock intention is durable and only changes recommendation eligibility", () => {
  assert.match(catalogSchema, /restockPolicy: z\.enum\(\["restock", "do_not_restock"\]\)/);
  assert.match(catalogService, /set_catalog_product_store_configuration_v2/);
  assert.match(catalogWorkspace, /Restock intention/);
  assert.match(catalogWorkspace, /Do not restock/);
  assert.match(catalogWorkspace, /does not archive the product or change stock history/);
  assert.match(replenishmentPage, /restock_policy/);
  assert.match(replenishmentPage, /=== "do_not_restock"/);
  assert.doesNotMatch(migration, /update public\.inventory_levels/);
  assert.doesNotMatch(migration, /insert into public\.inventory_movements/);
});

test("product archiving is centrally authorized, audited, and blocked by unresolved inventory work", () => {
  assert.match(catalogService, /set_catalog_product_archived_safely/);
  assert.match(catalogWorkspace, /Nothing is deleted/);
  assert.match(migration, /private\.has_permission\(target_organization_id, 'products\.manage'\)/);
  assert.match(migration, /public\.inventory_levels/);
  assert.match(migration, /public\.purchase_order_lines/);
  assert.match(migration, /public\.inventory_count_lines/);
  assert.match(migration, /public\.stock_request_lines/);
  assert.match(migration, /public\.stock_transfer_lines/);
  assert.match(migration, /public\.product_components/);
  assert.match(migration, /CATALOG_PRODUCT_ARCHIVED/);
  assert.match(migration, /private\.write_audit_log/);
  assert.doesNotMatch(migration, /delete from public\./);
});
