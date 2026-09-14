import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Inventory schema contract migration protects core truth and optional modules", async () => {
  const migration = await source("supabase/migrations/20260914120000_inventory_schema_contract.sql");

  assert.match(migration, /create or replace function public\.get_inventory_schema_contract/);
  assert.match(migration, /'contract_version', 1/);
  assert.match(migration, /'public\.inventory_levels'/);
  assert.match(migration, /'public\.inventory_movements'/);
  assert.match(migration, /'apply_inventory_change_v2'/);
  assert.match(migration, /'count_batches'/);
  assert.match(migration, /'direct_transfers'/);
  assert.match(migration, /'purchasing'/);
  assert.match(migration, /'valuation'/);
  assert.match(migration, /'replenishment'/);
  assert.match(migration, /\(select auth\.uid\(\)\) is null/);
  assert.match(migration, /employee\.profile_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /organization\.status = 'active'/);
  assert.match(migration, /employee\.status = 'active'/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /revoke all\s+on function public\.get_inventory_schema_contract\(uuid\)\s+from public/);
  assert.match(migration, /revoke all\s+on function public\.get_inventory_schema_contract\(uuid\)\s+from anon/);
  assert.match(migration, /grant execute\s+on function public\.get_inventory_schema_contract\(uuid\)\s+to authenticated/);
  assert.match(migration, /notify pgrst, 'reload schema'/);
});

test("Inventory loads schema compatibility before optional query fan-out", async () => {
  const [page, contract] = await Promise.all([
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
    source("src/features/inventory/inventory-schema-contract.ts"),
  ]);

  assert.match(contract, /INVENTORY_SCHEMA_CONTRACT_VERSION = 1/);
  assert.match(contract, /reason: "RPC_MISSING"/);
  assert.match(contract, /status: "outdated"/);
  assert.match(page, /await loadInventorySchemaContract\(/);
  assert.match(page, /Inventory update required/);
  assert.match(page, /const inventoryModules = inventorySchema\.modules/);
  assert.match(page, /inventoryModules\.count_batches/);
  const coreErrorBlock = page.match(
    /const coreError = \[([\s\S]*?)\]\.find\(\(result\) => result\.error\)/,
  )?.[1] ?? "";
  assert.doesNotMatch(coreErrorBlock, /inventoryCountBatchesResult/);
});
