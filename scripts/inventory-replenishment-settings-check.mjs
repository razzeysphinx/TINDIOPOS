import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, service, schema, csv, forms, workspace, data, exportRoute, workflows, actions] = await Promise.all([
  source("supabase/migrations/20260919013635_canonical_inventory_replenishment_settings.sql"),
  source("src/features/catalog/service.ts"), source("src/features/catalog/catalog-schema.ts"),
  source("src/features/catalog/catalog-csv.ts"), source("src/features/catalog/catalog-forms.tsx"),
  source("src/features/catalog/catalog-product-workspace.tsx"), source("src/features/catalog/data.ts"),
  source("src/app/api/catalog/export/route.ts"), source("src/features/inventory/supply-chain-workflows.tsx"),
  source("src/features/inventory/supply-chain-actions.ts"),
]);

test("legacy low-stock writes are retired behind canonical RPCs", () => {
  assert.match(migration, /guard_legacy_low_stock_level/);
  assert.match(migration, /revoke insert \(low_stock_level\), update \(low_stock_level\)/);
  assert.match(service, /set_catalog_product_store_configuration_v3/);
  assert.match(service, /import_catalog_products_v3/);
  assert.doesNotMatch(service, /target_low_stock_level|set_catalog_product_store_configuration_v2|import_catalog_products_v2/);
  assert.doesNotMatch(schema, /lowStockLevel/);
  assert.doesNotMatch(forms, /lowStockLevel/);
});

test("catalog CSV and display use the canonical effective threshold contract", () => {
  assert.doesNotMatch(exportRoute, /low_stock_level/);
  assert.match(csv, /low_stock_level is retired/);
  assert.doesNotMatch(csv, /"low_stock_level",/);
  assert.match(data, /inventory_replenishment_rules/);
  assert.match(workspace, /rule\?\.reorder_point \?\? legacyFallback/);
  assert.match(workspace, /candidate\.variant_id === level\.variant_id/);
});

test("replenishment remains advisory and stock-safe", () => {
  assert.match(actions, /upsert_inventory_replenishment_rule_v2/);
  assert.match(workflows, /rule\.targetStock - projectedQuantity/);
  assert.match(workflows, /Suggestions never create inventory documents on their own/);
  assert.doesNotMatch(actions, /from\("inventory_levels"\)\.(?:insert|update|delete)/);
  assert.doesNotMatch(actions, /from\("inventory_movements"\)\.insert/);
});
