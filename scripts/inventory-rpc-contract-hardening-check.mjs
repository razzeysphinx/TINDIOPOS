import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (file) => readFile(path.join(root, file), "utf8");

test("inventory command application boundary uses only v2/v3 contracts", async () => {
  const [actions, supplyChainActions, schema, workflow, page, types] = await Promise.all([
    source("src/features/inventory/advanced-inventory-actions.ts"),
    source("src/features/inventory/supply-chain-actions.ts"),
    source("src/features/inventory/advanced-inventory-schema.ts"),
    source("src/features/inventory/advanced-inventory-workflows.tsx"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/lib/supabase/database.types.ts"),
  ]);
  assert.match(actions, /rpc\("create_inventory_count_plan_v2"/);
  assert.match(actions, /rpc\("save_inventory_count_line_v2"/);
  assert.match(actions, /rpc\("create_purchase_order_v2"/);
  assert.match(actions, /rpc\("record_inventory_adjustment_v3"/);
  assert.doesNotMatch(actions, /as never|@ts-ignore|@ts-expect-error|completeInventoryCountAction|complete_inventory_count|create_inventory_count_draft/);
  assert.match(supplyChainActions, /rpc\("upsert_inventory_replenishment_rule_v2"/);
  assert.doesNotMatch(supplyChainActions, /as never|@ts-ignore|@ts-expect-error|rpc\("upsert_inventory_replenishment_rule"/);
  assert.doesNotMatch(schema, /completeInventoryCountSchema/);
  assert.doesNotMatch(workflow, /completeInventoryCountAction|"counts"/);
  assert.doesNotMatch(page, /sections=\{\["counts"\]\}/);
  assert.match(types, /create_inventory_count_plan_v2:[\s\S]*target_scope_reference_id\?: string/);
  assert.match(types, /save_inventory_count_line_v2:[\s\S]*target_variant_id\?: string/);
  assert.match(types, /create_purchase_order_v2:[\s\S]*target_expected_at\?: string/);
  assert.match(types, /record_inventory_adjustment_v3:[\s\S]*target_approval_request_id\?: string[\s\S]*target_variant_id\?: string/);
  assert.match(types, /upsert_inventory_replenishment_rule_v2:[\s\S]*target_preferred_warehouse_id\?: string[\s\S]*target_variant_id\?: string/);
  assert.doesNotMatch(types, /post_inventory_count:\s*\n\s*\|/);
});

test("forward migration preserves hardened public/private boundaries and retires old public commands", async () => {
  const migration = await source("supabase/migrations/20260916034301_inventory_command_rpc_contract_hardening.sql");
  for (const name of ["create_inventory_count_plan_v2", "save_inventory_count_line_v2", "create_purchase_order_v2", "record_inventory_adjustment_v3"]) {
    assert.match(migration, new RegExp(`function public\\.${name}`));
  }
  assert.equal((migration.match(/security invoker/g) ?? []).length, 4);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length, 4);
  assert.equal((migration.match(/from public, anon, service_role/g) ?? []).length, 4);
  assert.equal((migration.match(/to authenticated/g) ?? []).length, 4);
  assert.match(migration, /drop function if exists public\.post_inventory_count\(uuid, uuid\)/);
  assert.match(migration, /drop function if exists public\.complete_inventory_count/);
  assert.doesNotMatch(migration, /drop\s+function[\s\S]*cascade/i);
});

test("replenishment command moves optional UUIDs behind required inputs", async () => {
  const migration = await source("supabase/migrations/20260916040115_inventory_replenishment_rule_rpc_contract_v2.sql");
  assert.match(migration, /function public\.upsert_inventory_replenishment_rule_v2/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /from public, anon, service_role/);
  assert.match(migration, /to authenticated/);
  assert.match(migration, /drop function if exists public\.upsert_inventory_replenishment_rule/);
  assert.doesNotMatch(migration, /cascade/i);
});
