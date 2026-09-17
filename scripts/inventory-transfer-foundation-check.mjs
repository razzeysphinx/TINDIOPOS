import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const [
  migration,
  granularRbacMigration,
  advancedActions,
  supplyChainActions,
  posData,
  posTypes,
  posInbox,
  inventoryPage,
  integrityWorkflows,
  sqlTest,
] = await Promise.all([
  source("../supabase/migrations/20260917033614_canonical_inventory_transfer_foundation.sql"),
  source("../supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql"),
  source("../src/features/inventory/advanced-inventory-actions.ts"),
  source("../src/features/inventory/supply-chain-actions.ts"),
  source("../src/features/pos/data.ts"),
  source("../src/features/pos/pos-types.ts"),
  source("../src/features/pos/pos-incoming-transfer-inbox.tsx"),
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../src/features/inventory/inventory-integrity-workflows.tsx"),
  source("../supabase/tests/database/canonical_inventory_transfer_foundation.test.sql"),
]);

const canonicalPrivateBody = (command) => {
  const match = migration.match(new RegExp(
    `create or replace function private\\.${command}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  ));
  assert.ok(match, `missing private canonical command ${command}`);
  return match[0];
};

test("canonical transfer registry and six public commands are present", () => {
  assert.match(migration, /create table private\.stock_transfer_operations/);
  assert.match(migration, /unique \(organization_id, operation_id\)/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended/);

  for (const command of [
    "create_inventory_transfer_draft",
    "submit_inventory_transfer",
    "approve_inventory_transfer",
    "dispatch_inventory_transfer",
    "receive_inventory_transfer",
    "cancel_inventory_transfer",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${command}\\(`));
  }
});

test("canonical commands never assign legacy transfer states", () => {
  for (const command of [
    "create_inventory_transfer_draft",
    "submit_inventory_transfer",
    "approve_inventory_transfer",
    "dispatch_inventory_transfer",
    "receive_inventory_transfer",
    "cancel_inventory_transfer",
  ]) {
    const body = canonicalPrivateBody(command);
    assert.doesNotMatch(body, /set\s+status\s*=\s*'in_transit'/i);
    assert.doesNotMatch(body, /set\s+status\s*=\s*'completed'/i);
  }
});

test("transitional status contract keeps only canonical plus compatibility values", () => {
  for (const state of [
    "draft",
    "submitted",
    "approved",
    "dispatched",
    "partially_received",
    "received",
    "cancelled",
    "in_transit",
    "completed",
  ]) {
    assert.match(migration, new RegExp(`'${state}'`));
  }
  assert.match(migration, /stock_request_id is null[\s\S]*status = 'in_transit'/i);
  assert.match(migration, /set status = 'dispatched'/i);
});

test("direct compatibility adapters route through canonical engines", () => {
  const directAdapter = canonicalPrivateBody("create_direct_stock_transfer");
  assert.match(directAdapter, /private\.create_inventory_transfer_draft/);
  assert.match(directAdapter, /private\.submit_inventory_transfer/);
  assert.match(directAdapter, /private\.approve_inventory_transfer/);
  assert.match(directAdapter, /private\.dispatch_inventory_transfer/);

  const receiptAdapter = canonicalPrivateBody("receive_stock_transfer");
  assert.match(receiptAdapter, /private\.receive_inventory_transfer/);
});

test("request writers remain present and outside the Phase 05 migration", () => {
  assert.match(granularRbacMigration, /create or replace function private\.dispatch_stock_request/);
  assert.match(granularRbacMigration, /create or replace function private\.receive_stock_request/);
  assert.doesNotMatch(migration, /create or replace function private\.dispatch_stock_request/);
  assert.doesNotMatch(migration, /create or replace function private\.receive_stock_request/);
  assert.match(supplyChainActions, /supabase\.rpc\("dispatch_stock_request"/);
  assert.match(supplyChainActions, /supabase\.rpc\("receive_stock_request"/);
});

test("application command callers retain the direct RPC signatures", () => {
  assert.match(advancedActions, /supabase\.rpc\("create_direct_stock_transfer"/);
  assert.match(advancedActions, /supabase\.rpc\("receive_stock_transfer"/);
});

test("all active receiving readers accept canonical dispatched compatibility", () => {
  assert.match(migration, /transfer\.status in \('dispatched', 'in_transit', 'partially_received'\)/);
  assert.match(posData, /transfer\.status !== "dispatched"[\s\S]*transfer\.status !== "in_transit"[\s\S]*transfer\.status !== "partially_received"/);
  assert.match(posTypes, /"dispatched" \| "in_transit" \| "partially_received"/);
  assert.match(posInbox, /transfer\.status === "dispatched"/);
  assert.match(inventoryPage, /\.in\("status", \["dispatched", "in_transit", "partially_received"\]\)/);
  assert.match(integrityWorkflows, /"dispatched" \| "in_transit" \| "partially_received"/);
});

test("canonical stock effects use the immutable inventory engine", () => {
  const dispatchBody = canonicalPrivateBody("dispatch_inventory_transfer");
  const receiveBody = canonicalPrivateBody("receive_inventory_transfer");
  assert.match(dispatchBody, /for update/);
  assert.match(dispatchBody, /'TRANSFER_OUT'/);
  assert.match(dispatchBody, /private\.apply_inventory_change_v2/);
  assert.match(receiveBody, /'TRANSFER_IN'/);
  assert.match(receiveBody, /short_quantity/);
  assert.match(receiveBody, /private\.apply_inventory_change_v2/);
});

test("legacy immediate transfer is not used by the canonical foundation", () => {
  assert.match(granularRbacMigration, /create or replace function private\.transfer_stock/);
  assert.doesNotMatch(migration, /private\.transfer_stock\(/);
});

test("SQL regression covers lifecycle, replay, adapters, and request compatibility", () => {
  for (const evidence of [
    "draft is source-stock neutral",
    "dispatch deducts source stock once",
    "partial receipt credits only physical quantity",
    "post-dispatch cancellation is rejected",
    "conflicting dispatch replay is rejected",
    "historical direct retry returns the existing transfer",
    "historical receipt retry returns the original receipt",
    "request dispatch preserves temporary in_transit compatibility",
    "request receipt preserves temporary completed compatibility",
    "unknown transfer states are rejected",
  ]) {
    assert.match(sqlTest, new RegExp(evidence));
  }
});
