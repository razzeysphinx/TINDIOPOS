import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("Phase 6 defines granular inventory capabilities without role-name authorization", async () => {
  const migration = await source("supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql");

  for (const capability of [
    "inventory.transfer.create",
    "inventory.transfer.send",
    "inventory.transfer.receive",
    "inventory.count.create",
    "inventory.count.finalize",
    "inventory.adjust.create",
    "inventory.adjust.post",
    "inventory.valuation.view",
    "purchasing.view",
    "purchasing.po.create",
    "purchasing.receive",
    "purchasing.suppliers.manage",
    "purchasing.return",
  ]) {
    assert.match(migration, new RegExp(`'${capability.replaceAll(".", "\\.")}'`));
  }

  assert.match(migration, /from public\.role_permissions role_permission/);
  assert.doesNotMatch(migration, /role\.code\s*=|role_name/i);
  assert.match(migration, /role_permission\.permission_code = 'inventory\.manage'/);
  assert.match(migration, /role_permission\.permission_code = 'inventory\.transfers'/);
});

test("transfer RPCs retain canonical procedures but require granular capability contexts", async () => {
  const migration = await source("supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql");

  assert.match(migration, /alter function private\.create_direct_stock_transfer[\s\S]*inventory\.transfer\.create,inventory\.transfer\.send/);
  assert.match(migration, /alter function private\.receive_stock_transfer[\s\S]*inventory\.transfer\.receive/);
  assert.match(migration, /alter function private\.create_stock_request[\s\S]*inventory\.transfer\.create/);
  assert.match(migration, /alter function private\.dispatch_stock_request[\s\S]*inventory\.transfer\.send/);
  assert.match(migration, /alter function private\.receive_stock_request[\s\S]*inventory\.transfer\.receive/);
  assert.match(migration, /private\.has_all_inventory_capabilities/);
  assert.match(migration, /requested_permission = 'inventory\.manage'/);
  assert.doesNotMatch(migration, /update public\.inventory_levels/);
});

test("transfer reads and mutations require both capability and the existing store scope", async () => {
  const [migration, advancedActions, supplyActions] = await Promise.all([
    source("supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql"),
    source("src/features/inventory/advanced-inventory-actions.ts"),
    source("src/features/inventory/supply-chain-actions.ts"),
  ]);

  assert.match(migration, /private\.has_stock_transfer_read_scope/);
  assert.match(migration, /private\.has_stock_request_read_scope/);
  assert.match(migration, /warehouse\.store_id is not null/);
  assert.match(migration, /private\.has_store_read_scope/);
  assert.match(migration, /stock_transfers_select_inventory_transfer_scope/);
  assert.match(migration, /stock_transfer_receipts_select_inventory_transfer_scope/);

  assert.match(advancedActions, /requireInventoryCapabilities\([\s\S]*inventory\.transfer\.create[\s\S]*inventory\.transfer\.send/);
  assert.match(advancedActions, /requireInventoryCapabilities\([\s\S]*inventory\.transfer\.receive/);
  assert.match(supplyActions, /requireTransferCapabilities\([\s\S]*inventory\.transfer\.create/);
  assert.match(supplyActions, /requireTransferCapabilities\([\s\S]*inventory\.transfer\.send/);
  assert.match(supplyActions, /requireTransferCapabilities\([\s\S]*inventory\.transfer\.receive/);
});

test("transfer controls are hidden when their specific capability is absent", async () => {
  const [workspace, integrity, supplyChain, navigation] = await Promise.all([
    source("src/features/inventory/inventory-transfer-workspace.tsx"),
    source("src/features/inventory/inventory-integrity-workflows.tsx"),
    source("src/features/inventory/supply-chain-workflows.tsx"),
    source("src/features/inventory/inventory-workspace-navigation.tsx"),
  ]);

  assert.match(workspace, /canCreateTransfers/);
  assert.match(workspace, /canSendTransfers/);
  assert.match(integrity, /canReceiveTransfers/);
  assert.match(supplyChain, /canCreateTransfers/);
  assert.match(supplyChain, /canSendTransfers/);
  assert.match(supplyChain, /canReceiveTransfers/);
  assert.match(navigation, /canTransfer/);
});
