import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync("archive/database/supabase-migrations/20260930030000_neon_inventory_count_runtime_boundary_repair.sql", "utf8");
const page = fs.readFileSync("src/app/(back-office)/back-office/inventory/page.tsx", "utf8");

test("inventory count authorization is provider-neutral", () => {
  const start = migration.indexOf("create or replace function private.inventory_count_actor");
  const section = migration.slice(start, migration.indexOf("-- ---------------------------------------------------------------------------\n-- 2."));
  assert.ok(start >= 0);
  assert.match(section, /private\.current_profile_id\(\)/);
  assert.match(section, /private\.has_all_inventory_capabilities/);
  assert.match(section, /private\.has_store_read_scope/);
  assert.doesNotMatch(section, /\bauth\.uid\s*\(/i);
});

test("inventory count read RPCs are security definer and provider-neutral", () => {
  for (const name of ["get_inventory_counts_workspace_v2", "get_inventory_count_lines_workspace_v2", "get_inventory_count_batches_workspace_v2", "get_inventory_count_batch_documents_workspace_v2"]) {
    const index = migration.indexOf(`function public.${name}`);
    assert.ok(index >= 0, `${name} is missing`);
    const section = migration.slice(index, index + 9000);
    assert.match(section, /security definer/i);
    assert.match(section, /private\.(?:has_store_read_scope|has_any_inventory_capability)/);
  }
  assert.doesNotMatch(migration, /\bauth\.uid\s*\(/i);
});

test("Back Office inventory count reads use dedicated RPC boundaries", () => {
  for (const name of ["get_inventory_counts_workspace_v2", "get_inventory_count_lines_workspace_v2", "get_inventory_count_batches_workspace_v2", "get_inventory_count_batch_documents_workspace_v2"]) assert.match(page, new RegExp(name));
  const section = page.slice(page.indexOf("const inventoryCountsQuery"), page.indexOf("const inventoryCountsQuery") + 1800);
  assert.doesNotMatch(section, /\.from\("inventory_counts"\)/);
});
