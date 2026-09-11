import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("adjustment approval and read access use granular capabilities without bypassing store scope", async () => {
  const migration = await source("supabase/migrations/20260911021727_inventory_adjustment_activity_hardening.sql");

  assert.match(migration, /when 'inventory\.adjust' then 'inventory\.adjust\.post'/);
  assert.match(migration, /array\['inventory\.adjust\.create', 'inventory\.adjust\.post'\]/);
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, resolved_store_id\)/);
  assert.match(migration, /create or replace function private\.inventory_actor\(/);
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, target_store_id\)/);
  assert.match(migration, /inventory_adjustments_select_authorized_scope/);
  assert.match(migration, /inventory_movements_select_authorized/);
  assert.match(migration, /inventory\.count\.finalize/);
});

test("activity history is server-bounded and preserves its selected filters across pages", async () => {
  const page = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.match(page, /const INVENTORY_ACTIVITY_PAGE_SIZE = 50;/);
  assert.match(page, /resolveActivityPage\(parameters\.activityPage\)/);
  assert.match(page, /order\("created_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
  assert.match(page, /recentMovementsQuery\?\.range\(activityPageOffset, activityPageOffset \+ INVENTORY_ACTIVITY_PAGE_SIZE\)/);
  assert.match(page, /loadedMovements\.slice\(0, INVENTORY_ACTIVITY_PAGE_SIZE\)/);
  assert.match(page, /const inventoryActivityPageHref =/);
  assert.match(page, /query\.set\("movementType", activityMovementType\)/);
  assert.match(page, /query\.set\("sourceId", activitySourceFilter\.id\)/);
  assert.match(page, /Movement type/);
});
