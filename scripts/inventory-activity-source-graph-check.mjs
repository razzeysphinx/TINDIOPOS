import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("inventory activity filters one immutable source operation through the existing source index", async () => {
  const [page, migration, bundleMigration] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("archive/database/supabase-migrations/20260906062727_inventory_ledger_integrity_metadata.sql"),
    source("database/migrations/0005_inventory_core_read_model_extension.sql"),
  ]);

  assert.match(page, /const activitySourceFilter = activitySourceType && activitySourceId/);
  assert.match(page, /activitySourceType: activitySourceFilter\?\.type \?\? null/);
  assert.match(page, /activitySourceId: activitySourceFilter\?\.id \?\? null/);
  assert.match(bundleMigration, /requested_activity_source_type is null or source_type::text=requested_activity_source_type/);
  assert.match(bundleMigration, /requested_activity_source_id is null or source_id::text=requested_activity_source_id/);
  assert.match(page, /function InventoryActivitySourceContext/);
  assert.match(migration, /inventory_movements_source_lookup_idx/);
});

test("activity resolves canonical source labels without exposing raw source UUIDs", async () => {
  const page = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  for (const sourceType of [
    "inventory_adjustment",
    "inventory_count",
    "goods_receipt",
    "stock_transfer",
    "supplier_return",
    "production_run",
  ]) {
    assert.match(page, new RegExp(`inventorySourceHref\\("${sourceType}"`));
  }
  assert.match(page, /Refund for receipt \$\{receipt\.receipt_number\}/);
  assert.doesNotMatch(page, /label: `Transfer TR-\$\{transfer\.id\.slice/);
});

test("historical display survives catalog changes without broadening cost access", async () => {
  const [page, migration, coreLoader, bundleMigration] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("archive/database/supabase-migrations/20260907090000_inventory_activity_history_access.sql"),
    source("src/features/inventory/inventory-core-data.ts"),
    source("database/migrations/0005_inventory_core_read_model_extension.sql"),
  ]);

  assert.match(coreLoader, /coreNeeds\.push\("activityProducts", "activityStores"\)/);
  assert.match(bundleMigration, /'activityProducts'[\s\S]{0,280}select id,name,unit from public\.products/);
  assert.match(bundleMigration, /'activityStores'[\s\S]{0,280}select id,name from public\.stores/);
  assert.match(page, /unit: movement\.unit_snapshot \|\| product\?\.unit \|\| "units"/);
  assert.match(migration, /grant select \(unit_snapshot\) on table public\.inventory_movements to authenticated/);
  assert.doesNotMatch(migration, /grant select \(.*unit_cost_minor/);
  assert.doesNotMatch(migration, /grant select \(.*value_delta_minor/);
});
