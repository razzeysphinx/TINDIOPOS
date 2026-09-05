import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 5 requires adjustment review before reusing the controlled adjustment RPC", async () => {
  const workflow = await source("src/features/inventory/inventory-integrity-workflows.tsx");

  assert.match(workflow, /function reviewAdjustment\(/);
  assert.match(workflow, />Review adjustment</);
  assert.match(workflow, /label="Current"/);
  assert.match(workflow, /label="Adjustment"/);
  assert.match(workflow, /label="Result"/);
  assert.match(workflow, /The displayed balance is a review preview/);
  assert.match(workflow, /recordInventoryAdjustmentV2Action\(/);
  assert.match(workflow, /TINDIO locks and recalculates the authoritative stock level/);
});

test("Inventory Control preserves reviewed count documents and posts only through server-authoritative RPCs", async () => {
  const [workflow, countWorkspace, actions, lifecycleMigration] = await Promise.all([
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
    source("src/features/inventory/inventory-count-workspace.tsx"),
    source("src/features/inventory/advanced-inventory-actions.ts"),
    source("supabase/migrations/20260904021125_inventory_control_document_lifecycle.sql"),
  ]);

  assert.match(workflow, /function reviewCount\(/);
  assert.match(workflow, />Review count</);
  assert.match(workflow, />Expected<\/th>/);
  assert.match(workflow, />Counted<\/th>/);
  assert.match(workflow, />Difference<\/th>/);
  assert.match(workflow, /Post count adjustments<\/Button>/);
  assert.match(workflow, /completeInventoryCountAction\(/);
  assert.match(workflow, /TINDIO locks and recalculates each authoritative stock level/);
  assert.match(countWorkspace, /New inventory count/);
  assert.match(countWorkspace, /Count documents/);
  assert.match(countWorkspace, /<BackOfficeDetailDrawer/);
  assert.match(countWorkspace, /Submit for review/);
  assert.match(countWorkspace, /Post reviewed variance/);
  assert.match(actions, /create_inventory_count_draft/);
  assert.match(actions, /save_inventory_count_line/);
  assert.match(actions, /submit_inventory_count_for_review/);
  assert.match(actions, /post_inventory_count/);
  assert.match(lifecycleMigration, /draft', 'in_progress', 'ready_for_review', 'posted', 'cancelled'/);
  assert.match(lifecycleMigration, /Applying\s+--\s+that variance to the current locked projection preserves sales/s);
});

test("Inventory Control keeps one visible controlled adjustment form and shows scoped count documents", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.doesNotMatch(inventoryPage, /<InventoryAdjustmentForm/);
  assert.match(inventoryPage, /CANDIDATE_FOR_REMOVAL: the older approval-aware adjustment form/);
  assert.match(inventoryPage, /from\("inventory_counts"\)/);
  assert.match(inventoryPage, /<InventoryCountWorkspace/);
  assert.match(inventoryPage, /\.in\("status", \["draft", "in_progress", "ready_for_review", "posted", "cancelled", "open", "completed"\]\)/);
  assert.match(inventoryPage, /\.limit\(25\)/);
  assert.match(inventoryPage, /CANDIDATE_FOR_REMOVAL: the previous one-step count form/);
  assert.match(inventoryPage, /visibleStore\(count\.store_id\)/);
});

test("Phase 5 scopes count headers and lines through existing store-scope authority", async () => {
  const migration = await source("supabase/migrations/20260829102157_inventory_count_store_scope.sql");

  assert.match(migration, /inventory_counts_select_authorized_scope/);
  assert.match(migration, /inventory_count_lines_select_authorized_scope/);
  assert.match(migration, /private\.has_store_read_scope\(organization_id, store_id\)/);
  assert.match(migration, /from public\.inventory_counts inventory_count/);
  assert.doesNotMatch(migration, /grant\s+(select|all|execute)/i);
});

test("Phase 3 prepares one ordered, resumable inventory-count document per store", async () => {
  const [workspace, actions, page, migration] = await Promise.all([
    source("src/features/inventory/inventory-count-workspace.tsx"),
    source("src/features/inventory/advanced-inventory-actions.ts"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("supabase/migrations/20260905090100_inventory_count_preparation.sql"),
  ]);

  assert.match(workspace, /Full store/);
  assert.match(workspace, /Category/);
  assert.match(workspace, /Supplier/);
  assert.match(workspace, /Selected products/);
  assert.match(workspace, /Blind — hide expected quantity/);
  assert.match(workspace, /Include zero-stock items/);
  assert.match(workspace, /downloadCountCsv\(document\)/);
  assert.match(workspace, /data-inventory-count-print-document/);
  assert.match(actions, /requireInventoryCounter/);
  assert.match(actions, /create_inventory_count_plan/);
  assert.match(page, /hasPermission\(context, "inventory\.count"\) \|\| canManage/);
  assert.match(migration, /product\.status = 'active'/);
  assert.match(migration, /product\.track_inventory/);
  assert.match(migration, /row_number\(\) over \(order by/);
  assert.match(migration, /expected_quantity, null, product_name/);
});

test("Phase 3 keeps expected stock authoritative and posts only the snapshotted variance", async () => {
  const migration = await source("supabase/migrations/20260905090100_inventory_count_preparation.sql");

  assert.match(migration, /variance := line\.counted_quantity - line\.expected_quantity/);
  assert.match(migration, /private\.apply_inventory_change_v2/);
  assert.match(migration, /set counted_quantity = target_counted_quantity/);
  assert.doesNotMatch(migration, /set\s+quantity\s*=\s*(target_)?counted/i);
  assert.match(migration, /inventory\.count/);
  assert.match(migration, /private\.has_store_read_scope/);
});

test("Blind count print and CSV omit expected and variance columns", async () => {
  const workspace = await source("src/features/inventory/inventory-count-workspace.tsx");

  assert.match(workspace, /document\.countMode === "blind" \? \["Item", "Category", "SKU", "Barcode", "Unit", "Counted"\]/);
  assert.match(workspace, /document\.countMode === "standard" \? <th>Expected<\/th> : null/);
  assert.match(workspace, /Expected quantities stay hidden/);
});
