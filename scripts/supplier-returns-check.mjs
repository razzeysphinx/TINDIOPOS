import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [migration, actions, schema, workflows, purchasing] = await Promise.all([
  source("supabase/migrations/20260918035302_canonical_supplier_returns.sql"),
  source("src/features/inventory/advanced-inventory-actions.ts"),
  source("src/features/inventory/advanced-inventory-schema.ts"),
  source("src/features/inventory/inventory-integrity-workflows.tsx"),
  source("supabase/migrations/20260918023953_canonical_purchasing_receiving.sql"),
]);

test("supplier returns retain one public operation-aware application route", () => {
  assert.match(actions, /returnToSupplierAction[\s\S]*?"purchasing\.return"/);
  assert.match(actions, /rpc\("return_to_supplier"/);
  assert.match(schema, /returnToSupplierSchema[\s\S]*?operationId/);
  assert.match(workflows, /operationScope = "supplier-return:post"/);
  assert.match(workflows, /pendingOperationId\(operationScope, payload\)/);
  assert.doesNotMatch(actions, /schema\("private"\)[\s\S]*?return_to_supplier/);
  assert.doesNotMatch(actions, /from\("inventory_levels"\)\.(?:insert|update|delete)/);
});

test("canonical command serializes and compares the complete normalized payload", () => {
  assert.match(migration, /public\.return_to_supplier/);
  assert.match(migration, /security definer/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(migration, /normalized_lines/);
  assert.match(migration, /persisted_lines is distinct from normalized_lines/);
  assert.match(migration, /already assigned to a different supplier-return payload/);
  assert.match(migration, /drop function if exists public\.return_to_supplier\(uuid,uuid,uuid,jsonb,text\)/);
  assert.match(migration, /revoke all on function private\.return_to_supplier/);
});

test("posted evidence, ledger authority, and independent provenance are preserved", () => {
  assert.match(migration, /supplier_returns_guard_immutable/);
  assert.match(migration, /supplier_return_lines_guard_immutable/);
  assert.match(migration, /Posted supplier-return evidence is immutable/);
  assert.match(migration, /'SUPPLIER_RETURN'/);
  assert.match(migration, /'supplier_return'/);
  assert.match(migration, /stock_level\.average_cost_minor/);
  assert.match(migration, /'purchasing\.return'/);
  assert.doesNotMatch(migration, /update public\.(?:purchase_order_lines|goods_receipt_lines)/);
  assert.doesNotMatch(purchasing, /supplier_returns|supplier_return_lines|return_to_supplier/);
});
