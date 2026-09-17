import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, actions, workspace, batchMigration, reconciliationMigration, sqlTest, concurrency] = await Promise.all([
  read("../supabase/migrations/20260917152516_canonical_inventory_counts_stocktake.sql"),
  read("../src/features/inventory/advanced-inventory-actions.ts"),
  read("../src/features/inventory/inventory-count-workspace.tsx"),
  read("../supabase/migrations/20260911014827_inventory_count_batches_and_roundtrip_import.sql"),
  read("../supabase/migrations/20260906121112_inventory_count_concurrent_reconciliation.sql"),
  read("../supabase/tests/database/canonical_inventory_counts_stocktake.test.sql"),
  read("./inventory-count-concurrency-certification.mjs"),
]);

test("application count workflows use the canonical command surface", () => {
  for (const command of [
    "create_inventory_count_plan_v2", "save_inventory_count_line_v2",
    "import_inventory_count_lines", "create_inventory_count_batch",
  ]) assert.match(actions, new RegExp(`rpc\\(\"${command}\"`));
  for (const command of ["submit_inventory_count_for_review", "post_inventory_count", "cancel_inventory_count"])
    assert.match(actions, new RegExp(`operation:.*${command}|operation === \"${command}\"`));
  assert.doesNotMatch(actions, /rpc\("(?:create_inventory_count_draft|complete_inventory_count)"/);
  assert.doesNotMatch(workspace, /update\s+(?:public\.)?inventory_levels/i);
  assert.match(actions, /inventory\.count\.create/);
  assert.match(actions, /inventory\.count\.finalize/);
});

test("count lifecycle is canonical while historical states remain read-only", () => {
  assert.match(migration, /alter column status set default 'draft'/);
  assert.match(migration, /Legacy inventory count states are read-only compatibility evidence/);
  assert.match(migration, /Posted inventory counts are immutable/);
  assert.match(migration, /status not in \('draft', 'in_progress', 'ready_for_review'\)/);
  assert.match(migration, /revoke execute on function private\.post_inventory_count\(uuid, uuid\)/);
  assert.match(workspace, /status === "draft" \|\| document\.status === "in_progress"/);
  assert.match(workspace, /document\.status === "ready_for_review"/);
});

test("physical saves, imports, batches, and posting preserve one ledger authority", () => {
  assert.match(migration, /INVENTORY_COUNT_LINE_SAVED/);
  assert.match(batchMigration, /private\.save_inventory_count_line/);
  assert.doesNotMatch(batchMigration, /update\s+public\.inventory_levels/i);
  assert.match(reconciliationMigration, /reconciled_expected_quantity/);
  assert.match(reconciliationMigration, /private\.apply_inventory_change_v2/);
  assert.match(sqlTest, /CSV line entry delegates to manual validation and remains stock-neutral/);
  assert.match(sqlTest, /multi-store batch creation coordinates independent stock-neutral documents/);
  assert.match(concurrency, /Promise\.all\(/);
  assert.match(concurrency, /physicalMutations === 1/);
  assert.match(concurrency, /reconcileInventoryState/);
});
