import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("controlled adjustments retain their approval review and authoritative ledger boundary", async () => {
  const [workflow, actions] = await Promise.all([
    source("src/features/inventory/inventory-integrity-workflows.tsx"),
    source("src/features/inventory/advanced-inventory-actions.ts"),
  ]);

  assert.match(workflow, /function reviewAdjustment\(/);
  assert.match(workflow, />Review adjustment</);
  assert.match(workflow, /recordInventoryAdjustmentV2Action\(/);
  assert.match(actions, /rpc\("record_inventory_adjustment_v3"/);
  assert.doesNotMatch(actions, /as never|@ts-ignore|@ts-expect-error/);
});

test("Inventory Count Workspace is the only live count lifecycle", async () => {
  const [workspace, actions, schema, workflow, page, reconciliation] = await Promise.all([
    source("src/features/inventory/inventory-count-workspace.tsx"),
    source("src/features/inventory/advanced-inventory-actions.ts"),
    source("src/features/inventory/advanced-inventory-schema.ts"),
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("supabase/migrations/20260906121112_inventory_count_concurrent_reconciliation.sql"),
  ]);

  assert.match(workspace, /New inventory count/);
  assert.match(workspace, /getInventoryOperationId/);
  assert.match(workspace, /inventory-count-post:\$\{inventoryCountId\}/);
  assert.match(workspace, /postInventoryCountAction\(\{ inventoryCountId, operationId \}\)/);
  assert.match(workspace, /clearInventoryOperationId\(operationScope\)/);
  assert.match(actions, /createInventoryCountDraftAction/);
  assert.match(actions, /saveInventoryCountLineAction/);
  assert.match(actions, /submitInventoryCountForReviewAction/);
  assert.match(actions, /postInventoryCountAction/);
  assert.match(actions, /cancelInventoryCountAction/);
  assert.match(actions, /create_inventory_count_plan_v2/);
  assert.match(actions, /save_inventory_count_line_v2/);
  assert.doesNotMatch(actions, /completeInventoryCountAction|complete_inventory_count|create_inventory_count_draft/);
  assert.doesNotMatch(schema, /completeInventoryCountSchema/);
  assert.doesNotMatch(workflow, /completeInventoryCountAction|"counts"/);
  assert.doesNotMatch(page, /sections=\{\["counts"\]\}/);
  assert.match(reconciliation, /variance := line\.counted_quantity - line\.reconciled_expected_quantity/);
  assert.doesNotMatch(reconciliation, /set\s+quantity\s*=\s*(target_)?counted/i);
});
