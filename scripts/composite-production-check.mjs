import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, actions, schema, workflows, catalogService, catalogData, catalogWorkspace, inventoryPage, checkoutMigration] = await Promise.all([
  source("supabase/migrations/20260918193000_canonical_composite_production.sql"),
  source("src/features/inventory/advanced-inventory-actions.ts"),
  source("src/features/inventory/advanced-inventory-schema.ts"),
  source("src/features/inventory/inventory-integrity-workflows.tsx"),
  source("src/features/catalog/service.ts"),
  source("src/features/catalog/data.ts"),
  source("src/features/catalog/catalog-product-workspace.tsx"),
  source("src/app/(back-office)/back-office/inventory/page.tsx"),
  source("supabase/migrations/20260921190000_made_to_order_composite_checkout_stock.sql"),
]);

test("composite recipe consumption has one explicit mode contract", () => {
  assert.match(migration, /composite_inventory_mode/);
  assert.match(migration, /made_to_order/);
  assert.match(migration, /stocked_assembly/);
  assert.match(migration, /parent\.composite_inventory_mode = 'made_to_order'/);
  assert.match(migration, /product\.composite_inventory_mode = 'stocked_assembly'/);
  assert.match(migration, /products_protect_composite_inventory_mode/);
  assert.match(migration, /before update of composite_inventory_mode, is_composite on public\.products/);
  assert.match(migration, /products_composite_inventory_mode_consistency/);
  assert.match(migration, /Composite stock mode cannot change after inventory history begins/);
  assert.match(catalogService, /create_catalog_product_v3/);
  assert.match(catalogService, /update_catalog_product_v3/);
  assert.match(catalogData, /composite_inventory_mode/);
  assert.match(catalogWorkspace, /compositeInventoryMode/);
  assert.match(inventoryPage, /composite_inventory_mode === "stocked_assembly"/);
});

test("production has one replay-safe public command and immutable evidence", () => {
  assert.match(actions, /produceCompositeAction[\s\S]*?rpc\("produce_composite"/);
  assert.match(schema, /produceCompositeSchema[\s\S]*?operationId/);
  assert.match(workflows, /operationScope = "production:post"/);
  assert.match(workflows, /pendingOperationId\(operationScope, payload\)/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /normalized_payload/);
  assert.match(migration, /production_run_components/);
  assert.match(migration, /grant select \([\s\S]*quantity_consumed[\s\S]*unit_snapshot[\s\S]*created_at[\s\S]*\) on public\.production_run_components to authenticated/);
  assert.doesNotMatch(migration, /grant select on public\.production_run_components to authenticated/);
  assert.match(migration, /Stocked assembly recipe components must track inventory/);
  assert.match(migration, /production_runs_guard_immutable/);
  assert.match(migration, /production_run_components_guard_immutable/);
  assert.match(migration, /drop function if exists public\.produce_composite\(uuid,uuid,uuid,numeric,text\)/);
  assert.match(migration, /drop function if exists private\.produce_composite\(uuid,uuid,uuid,numeric,text,uuid\)/);
  assert.doesNotMatch(actions, /schema\("private"\)[\s\S]*?produce_composite/);
});

test("production cost and stock posting stay on the canonical inventory ledger", () => {
  assert.match(migration, /component_level\.average_cost_minor/);
  assert.match(migration, /components_cost_known/);
  assert.match(migration, /private\.apply_inventory_change_v2/);
  assert.match(migration, /'production_run'/);
  assert.match(migration, /'PRODUCTION_COMPLETED'/);
  assert.doesNotMatch(actions, /from\("inventory_levels"\)\.(?:insert|update|delete)/);
});

test("made-to-order checkout consumes recipe components without parent finished-stock deduction", () => {
  assert.match(checkoutMigration, /private\.is_made_to_order_composite/);
  assert.match(checkoutMigration, /private\.consume_made_to_order_composite_sale/);
  assert.match(checkoutMigration, /elsif tracks_inventory then/);
  assert.match(checkoutMigration, /private\.checkout_catalog_special_sale/);
  assert.match(checkoutMigration, /'composite_sale'/);
});
