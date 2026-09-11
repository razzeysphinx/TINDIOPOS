import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFile(path.join(root, relativePath), "utf8");

test("Phase 8 extends the canonical count document for paper and spreadsheet stocktakes", async () => {
  const workspace = await source("src/features/inventory/inventory-count-workspace.tsx");

  assert.match(workspace, /Spreadsheet CSV/);
  assert.match(workspace, /Import CSV/);
  assert.match(workspace, /Count line ID/);
  assert.match(workspace, /Blank cells remain uncounted; an explicit 0 records a physical zero/);
  assert.match(workspace, /Rows detected/);
  assert.match(workspace, /Invalid/);
  assert.match(workspace, /Duplicate/);
  assert.match(workspace, /Unknown/);
  assert.match(workspace, /data-inventory-print-unexpected/);
  assert.match(workspace, /item\.storeIds\.includes\(document\.storeId\)/);
  assert.doesNotMatch(workspace, /update\s+inventory_levels/i);
});

test("Phase 8 keeps multi-store batches as coordination over independent store count documents", async () => {
  const [workspace, migration] = await Promise.all([
    source("src/features/inventory/inventory-count-workspace.tsx"),
    source("supabase/migrations/20260911014827_inventory_count_batches_and_roundtrip_import.sql"),
  ]);

  assert.match(workspace, /New count batch/);
  assert.match(workspace, /Each store receives its own count document/);
  assert.match(workspace, /Store counts/);
  assert.match(migration, /create table if not exists public\.inventory_count_batches/);
  assert.match(migration, /create table if not exists public\.inventory_count_batch_documents/);
  assert.match(migration, /private\.create_inventory_count_plan/);
  assert.match(migration, /INVENTORY_COUNT_BATCH_PREPARED/);
  assert.doesNotMatch(migration, /update\s+public\.inventory_levels/i);
});

test("count preparation, import, review, and posting use granular capability and store-scope enforcement", async () => {
  const [actions, migration, page] = await Promise.all([
    source("src/features/inventory/advanced-inventory-actions.ts"),
    source("supabase/migrations/20260911014827_inventory_count_batches_and_roundtrip_import.sql"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
  ]);

  assert.match(actions, /requireInventoryCountCapability/);
  assert.match(actions, /"inventory\.count\.create"/);
  assert.match(actions, /"inventory\.count\.finalize"/);
  assert.match(actions, /import_inventory_count_lines/);
  assert.match(migration, /private\.has_all_inventory_capabilities/);
  assert.match(migration, /private\.has_store_read_scope/);
  assert.match(migration, /inventory_counts_select_authorized_scope/);
  assert.match(migration, /inventory_count_lines_select_authorized_scope/);
  assert.match(migration, /Only an open inventory count can import physical quantities/);
  assert.match(migration, /private\.save_inventory_count_line/);
  assert.match(migration, /grant execute on function private\.create_inventory_count_batch[\s\S]*to authenticated/);
  assert.match(migration, /grant execute on function private\.import_inventory_count_lines[\s\S]*to authenticated/);
  assert.match(page, /canCreateCounts/);
  assert.match(page, /canFinalizeCounts/);
});
