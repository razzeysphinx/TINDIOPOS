import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");

test("Inventory schema contract v3 certifies the provider-neutral command boundary", async () => {
  const migration = await source("supabase/migrations/20260916044235_inventory_schema_contract_v3.sql");

  assert.match(migration, /create or replace function public\.get_inventory_schema_contract/);
  assert.match(migration, /'contract_version', 3/);
  assert.match(migration, /resolved_profile_id := private\.current_profile_id\(\)/);
  assert.match(migration, /employee\.profile_id = resolved_profile_id/);
  assert.doesNotMatch(migration, /employee\.profile_id = \(select auth\.uid\(\)\)/);
  for (const signature of [
    "create_inventory_count_plan_v2(uuid,uuid,text,text,text,jsonb,text,boolean,uuid)",
    "save_inventory_count_line_v2(uuid,uuid,uuid,numeric,uuid)",
    "post_inventory_count(uuid,uuid,uuid)",
    "create_purchase_order_v2(uuid,uuid,uuid,text,jsonb,uuid,date)",
    "record_inventory_adjustment_v3(uuid,uuid,uuid,numeric,text,text,uuid,uuid,uuid)",
  ]) assert.match(migration, new RegExp(signature.replace(/[()]/g, "\\$&")));
  assert.match(migration, /legacy_complete_inventory_count/);
  assert.match(migration, /legacy_post_inventory_count/);
  assert.match(migration, /upsert_inventory_replenishment_rule_v2\(uuid,uuid,uuid,numeric,numeric,uuid,uuid\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all on function public\.get_inventory_schema_contract\(uuid\)\s+from public, anon, service_role/);
  assert.match(migration, /grant execute on function public\.get_inventory_schema_contract\(uuid\)\s+to authenticated/);
});

test("Inventory requires schema contract version 3 before querying optional modules", async () => {
  const [page, contract] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-schema-contract.ts"),
  ]);

  assert.match(contract, /INVENTORY_SCHEMA_CONTRACT_VERSION = 3/);
  assert.match(contract, /reason: "RPC_MISSING"/);
  assert.match(page, /await loadInventorySchemaContract\(/);
  assert.match(page, /Inventory update required/);
});
