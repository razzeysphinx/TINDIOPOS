import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

async function migrationSources(relativePath = "supabase/migrations") {
  const directory = path.join(repositoryRoot, relativePath);
  const entries = await readdir(directory, { withFileTypes: true });
  const sources = [];
  for (const entry of entries) {
    const entryPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) sources.push(...await migrationSources(entryPath));
    else if (entry.isFile() && entry.name.endsWith(".sql")) sources.push(await source(entryPath));
  }
  return sources;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionOccurrences(sql, qualifiedName) {
  const pattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegExp(qualifiedName)}\\s*\\(`,
    "gi",
  );
  return [...sql.matchAll(pattern)];
}

function extractFunctionBlock(sql, qualifiedName) {
  const occurrences = functionOccurrences(sql, qualifiedName);
  assert.equal(
    occurrences.length,
    1,
    `${qualifiedName} must be defined exactly once in the granular transfer migration`,
  );

  const start = occurrences[0].index;
  const bodyStart = sql.indexOf("as $$", start);
  assert.notEqual(bodyStart, -1, `${qualifiedName} must contain an AS $$ function body`);

  const end = sql.indexOf("$$;", bodyStart + 5);
  assert.notEqual(end, -1, `${qualifiedName} must terminate with $$;`);

  return sql.slice(start, end + 3);
}

function removeFunctionBlocks(sql) {
  const functionPattern = /create\s+or\s+replace\s+function\s+[a-zA-Z0-9_.]+\s*\(/gi;
  let cursor = 0;
  let remaining = "";

  while (true) {
    functionPattern.lastIndex = cursor;
    const match = functionPattern.exec(sql);
    if (!match) {
      remaining += sql.slice(cursor);
      break;
    }

    remaining += sql.slice(cursor, match.index);
    const bodyStart = sql.indexOf("as $$", match.index);
    assert.notEqual(bodyStart, -1, `Function beginning at offset ${match.index} is missing AS $$`);
    const end = sql.indexOf("$$;", bodyStart + 5);
    assert.notEqual(end, -1, `Function beginning at offset ${match.index} is missing closing $$;`);
    cursor = end + 3;
  }

  return remaining;
}

function assertCapabilityInsideFunction(sql, qualifiedName, capabilities) {
  const block = extractFunctionBlock(sql, qualifiedName);
  for (const capability of capabilities) {
    assert.match(
      block,
      new RegExp(escapeRegExp(capability)),
      `${qualifiedName} must contain ${capability} inside its own function body`,
    );
  }
}

function countPattern(sourceText, pattern) {
  return [...sourceText.matchAll(pattern)].length;
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

test("granular transfer migration has one coherent transaction and no orphan PL/pgSQL fragments", async () => {
  const migration = await source("supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql");
  const withoutComments = migration.replace(/--.*$/gm, "");

  assert.doesNotMatch(
    migration,
    /tokens?\s+truncated|…\s*\d+|\.\.\.\s*\d+\s+tokens?\s+truncated/i,
    "migration must never contain tool-output truncation markers",
  );

  assert.equal(countPattern(withoutComments, /^\s*begin\s*;\s*$/gim), 1, "migration must have exactly one top-level BEGIN;");
  assert.equal(countPattern(withoutComments, /^\s*commit\s*;\s*$/gim), 1, "migration must have exactly one top-level COMMIT;");

  const outsideFunctions = removeFunctionBlocks(migration);
  for (const orphanPattern of [
    /\breceipt_id\s+uuid\s*;/i,
    /\bexisting_receipt\s+public\.stock_transfer_receipts%rowtype\s*;/i,
    /\brequested_payload\s+jsonb\s*;/i,
    /\breturning\s+id\s+into\s+receipt_id\s*;/i,
    /\bfor\s+line\s+in\s+select\s+value\s+from\s+jsonb_array_elements\(target_lines\)/i,
  ]) {
    assert.doesNotMatch(
      outsideFunctions,
      orphanPattern,
      `PL/pgSQL fragment appears outside a CREATE OR REPLACE FUNCTION block: ${orphanPattern}`,
    );
  }
});

test("transfer RPCs retain canonical procedures with capabilities inside the correct function body", async () => {
  const migration = await source("supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql");

  assert.match(migration, /private\.has_all_inventory_capabilities/);
  assert.doesNotMatch(migration, /pg_get_functiondef\s*\(/i);
  assert.doesNotMatch(migration, /updated_definition\s*:=\s*replace\s*\(/i);
  assert.doesNotMatch(migration, /execute\s+updated_definition/i);
  assert.doesNotMatch(migration, /tindio\.inventory_required_capabilities/);

  const capabilityMatrix = new Map([
    ["private.transfer_stock", ["inventory.transfer.create", "inventory.transfer.send"]],
    ["private.create_stock_request", ["inventory.transfer.create"]],
    ["private.approve_stock_request", ["inventory.transfer.send"]],
    ["private.start_stock_request_picking", ["inventory.transfer.send"]],
    ["private.dispatch_stock_request", ["inventory.transfer.send"]],
    ["private.receive_stock_request", ["inventory.transfer.receive"]],
    ["private.create_direct_stock_transfer", ["inventory.transfer.create", "inventory.transfer.send"]],
    ["private.receive_stock_transfer", ["inventory.transfer.receive"]],
  ]);

  for (const [qualifiedName, capabilities] of capabilityMatrix) {
    assertCapabilityInsideFunction(migration, qualifiedName, capabilities);
  }

  assert.match(migration, /private\.has_permission\(target_organization_id, 'inventory\.manage'\)/);
  assert.doesNotMatch(migration, /update public\.inventory_levels/);
});

test("no migration can reintroduce hidden inventory capability routing", async () => {
  for (const migration of await migrationSources()) {
    assert.doesNotMatch(migration, /tindio\.inventory_required_capabilities/);
  }
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

test("Inventory application RBAC uses the central capability catalog without role names", async () => {
  const [capabilities, dal, page] = await Promise.all([
    source("src/lib/auth/inventory-capabilities.ts"),
    source("src/lib/auth/dal.ts"),
    source("src/app/(back-office)/back-office/inventory/page.tsx"),
  ]);

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
    assert.match(capabilities, new RegExp(`"${capability.replaceAll(".", "\\.")}"`));
  }

  assert.match(dal, /hasInventoryBackOfficeResponsibility/);
  assert.match(dal, /hasInventoryControlResponsibility/);
  assert.match(dal, /hasPurchasingResponsibility/);
  assert.doesNotMatch(dal, /const BACK_OFFICE_PERMISSIONS = \[[\s\S]*inventory\.transfer\.create/);
  assert.match(page, /requireBackOfficeContext\(\)/);
  assert.match(page, /hasInventoryBackOfficeResponsibility/);
  assert.doesNotMatch(page, /requireBackOfficePermission\(/);
  assert.match(page, /hasPermission\(context, "products\.view_cost"\)\s*&&\s*hasInventoryCapability\(context, "inventory\.valuation\.view"\)/);

  for (const legacyPermission of [
    "inventory.manage",
    "inventory.transfers",
    "inventory.count",
    "inventory.adjust",
    "inventory.purchase_orders",
    "inventory.receive",
    "inventory.suppliers",
  ]) {
    assert.match(capabilities, new RegExp(`"${legacyPermission.replaceAll(".", "\\.")}"`));
  }

  assert.doesNotMatch(capabilities, /role\s*===|roleNames\.includes/i);
  assert.doesNotMatch(dal, /role\s*===|roleNames\.includes/i);
  assert.doesNotMatch(page, /role\s*===|roleNames\.includes/i);
});
