import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [migration, actions, workflow, catalogActions, catalogForms, sqlTest, concurrency] = await Promise.all([
  read("../supabase/migrations/20260917122822_canonical_inventory_adjustments_opening_stock.sql"),
  read("../src/features/inventory/advanced-inventory-actions.ts"),
  read("../src/features/inventory/inventory-integrity-workflows.tsx"),
  read("../src/features/catalog/actions.ts"),
  read("../src/features/catalog/catalog-forms.tsx"),
  read("../supabase/tests/database/canonical_inventory_adjustments_opening_stock.test.sql"),
  read("./inventory-adjustment-concurrency-certification.mjs"),
]);

test("one canonical application command owns manual adjustments and opening stock", () => {
  assert.match(actions, /export async function recordInventoryAdjustmentAction/);
  assert.match(actions, /rpc\("record_inventory_adjustment_v3"/);
  assert.match(workflow, /recordInventoryAdjustmentAction\(/);
  assert.doesNotMatch(actions, /recordInventoryAdjustmentV2Action|rpc\("adjust_inventory"|rpc\("record_inventory_adjustment_v2"/);
  assert.doesNotMatch(catalogActions, /adjustInventoryAction|rpc\("adjust_inventory"/);
  assert.doesNotMatch(catalogForms, /InventoryAdjustmentForm|adjustInventoryAction/);
});

test("canonical posting reserves operation identity before physical mutation", () => {
  assert.match(migration, /insert into public\.inventory_adjustments[\s\S]*on conflict \(organization_id, operation_id\) do nothing/);
  assert.match(migration, /if adjustment_id is null then[\s\S]*existing adjustment is missing its inventory movement/i);
  assert.match(migration, /private\.apply_inventory_change_v2/);
  assert.match(migration, /Opening stock can only be recorded once for an item with no prior movement/);
  assert.match(migration, /product\.product_type = 'simple'[\s\S]*product\.product_type = 'variable'/);
  assert.doesNotMatch(migration, /grant execute on function (?:private|public)\.(?:adjust_inventory|record_inventory_adjustment_v2)/);
});

test("Phase 07 evidence covers lifecycle, isolation, concurrency, and reconciliation", () => {
  assert.match(sqlTest, /opening stock posts through the canonical command/);
  assert.match(sqlTest, /positive manual adjustment succeeds/);
  assert.match(sqlTest, /negative manual adjustment succeeds/);
  assert.match(sqlTest, /cross-organization direct RPC invocation is denied/);
  assert.match(sqlTest, /store-scoped adjuster cannot mutate an unassigned store/);
  assert.match(sqlTest, /ledger-derived quantity equals the projection/);
  assert.match(concurrency, /Promise\.all\(/);
  assert.match(concurrency, /physicalMutations: 1/);
  assert.match(concurrency, /reconcileInventoryState/);
});
