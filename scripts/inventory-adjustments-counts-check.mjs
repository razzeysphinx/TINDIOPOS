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

test("Phase 5 requires count review and posts only through the existing count RPC", async () => {
  const workflow = await source("src/features/inventory/advanced-inventory-workflows.tsx");

  assert.match(workflow, /function reviewCount\(/);
  assert.match(workflow, />Review count</);
  assert.match(workflow, />Expected<\/th>/);
  assert.match(workflow, />Counted<\/th>/);
  assert.match(workflow, />Difference<\/th>/);
  assert.match(workflow, /Post count adjustments<\/Button>/);
  assert.match(workflow, /completeInventoryCountAction\(/);
  assert.match(workflow, /TINDIO locks and recalculates each authoritative stock level/);
});

test("Phase 5 keeps one visible controlled adjustment form and shows scoped count history", async () => {
  const inventoryPage = await source("src/app/(back-office)/back-office/inventory/page.tsx");

  assert.doesNotMatch(inventoryPage, /<InventoryAdjustmentForm/);
  assert.match(inventoryPage, /CANDIDATE_FOR_REMOVAL: the older approval-aware adjustment form/);
  assert.match(inventoryPage, /from\("inventory_counts"\)/);
  assert.match(inventoryPage, /\.eq\("status", "completed"\)/);
  assert.match(inventoryPage, /\.limit\(25\)/);
  assert.match(inventoryPage, />Recent count records</);
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
