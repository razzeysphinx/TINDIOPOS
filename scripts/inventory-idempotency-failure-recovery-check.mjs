import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  actions,
  countWorkspace,
  offlineSync,
  incomingTransfers,
  migration,
] = await Promise.all([
  source("../src/features/inventory/advanced-inventory-actions.ts"),
  source("../src/features/inventory/inventory-count-workspace.tsx"),
  source("../src/features/offline/offline-sync.ts"),
  source("../src/features/pos/pos-incoming-transfer-inbox.tsx"),
  source("../supabase/migrations/20260911112514_inventory_count_post_idempotency.sql"),
]);

test("inventory-count posting retains one operation ID through an uncertain client response", () => {
  assert.match(countWorkspace, /getInventoryOperationId\(operationScope\)/);
  assert.match(countWorkspace, /operationScope = `inventory-count-post:\$\{inventoryCountId\}`/);
  assert.match(countWorkspace, /postInventoryCountAction\(\{ inventoryCountId, operationId \}\)/);
  assert.match(countWorkspace, /if \(posted\) clearInventoryOperationId\(operationScope\)/);
  assert.match(actions, /operation === "post_inventory_count" && !parsed\.data\.operationId/);
  assert.match(actions, /target_operation_id: parsed\.data\.operationId/);
});

test("the database replay guard locks the canonical count and delegates ledger work once", () => {
  assert.match(migration, /add column if not exists post_operation_id uuid/);
  assert.match(migration, /create unique index if not exists inventory_counts_organization_post_operation_id_key/);
  assert.match(migration, /where post_operation_id is not null/);
  assert.match(migration, /create or replace function private\.post_inventory_count_idempotent/);
  assert.match(migration, /for update/);
  assert.match(migration, /private\.inventory_count_actor\([\s\S]*count_document\.store_id,[\s\S]*inventory\.count\.finalize/);
  assert.doesNotMatch(migration, /tindio\.inventory_required_capabilities/);
  assert.match(migration, /count_document\.status = 'posted'[\s\S]*count_document\.post_operation_id = target_operation_id[\s\S]*return/);
  assert.match(migration, /perform private\.post_inventory_count\(target_organization_id, target_inventory_count_id\)/);
  assert.doesNotMatch(migration, /apply_inventory_change_v2/);
});

test("Phase 13 preserves serialized POS offline delivery and keeps cross-store receipts online", () => {
  assert.match(offlineSync, /tindio-offline-sync:\$\{scope\}/);
  assert.match(offlineSync, /activeSyncs = new Map<string, Promise<OfflineSyncReport>>/);
  assert.match(incomingTransfers, /internet connection/i);
  assert.doesNotMatch(incomingTransfers, /offline.*queue|queue.*offline/i);
});
