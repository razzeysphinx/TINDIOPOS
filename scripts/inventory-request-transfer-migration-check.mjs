import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migrationPath = "../supabase/migrations/20260917073801_canonical_request_transfer_migration.sql";
const [migration, reader, replenishment, posInbox, foundationTest] = await Promise.all([
  read(migrationPath),
  read("../src/features/inventory/inventory-transfer-reader-contract.ts"),
  read("../src/app/(back-office)/back-office/replenishment/page.tsx"),
  read("../src/features/pos/pos-incoming-transfer-inbox.tsx"),
  read("../supabase/tests/database/canonical_inventory_transfer_foundation.test.sql"),
]);

test("request adapters share private canonical physical cores", () => {
  assert.match(migration, /create or replace function private\.dispatch_inventory_transfer_core/);
  assert.match(migration, /dispatch_stock_request[\s\S]*dispatch_inventory_transfer_core/);
  assert.match(migration, /create or replace function private\.receive_inventory_transfer_core/);
  assert.match(migration, /receive_stock_request[\s\S]*receive_inventory_transfer_core/);
});

test("direct wrappers preserve direct-only guards", () => {
  assert.match(migration, /dispatch_inventory_transfer\([\s\S]*transfer\.stock_request_id is not null[\s\S]*canonical direct transfer/);
  assert.match(migration, /receive_inventory_transfer\([\s\S]*transfer\.stock_request_id is not null[\s\S]*replenishment transfers/);
});

test("request dispatch uses deterministic canonical operation identities", () => {
  assert.match(migration, /target_operation_id, 'create'/);
  for (const command of ["submit", "approve", "dispatch"]) {
    assert.match(migration, new RegExp(`inventory_transfer_child_operation_id\\(target_operation_id, '${command}'\\)`));
  }
  assert.doesNotMatch(migration, /gen_random_uuid\(\)/);
});

test("physical lifecycle is canonical and discrepancy remains request-only", () => {
  assert.match(migration, /status in \('draft', 'submitted', 'approved', 'dispatched', 'partially_received', 'received', 'cancelled'\)/);
  assert.match(migration, /stock_requests set status = case[\s\S]*received_with_discrepancy/);
  assert.doesNotMatch(migration, /stock_transfers set status = [^;]*received_with_discrepancy/);
  assert.match(migration, /status = 'dispatched' where status = 'in_transit'/);
  assert.match(migration, /status = 'received'[\s\S]*where status = 'completed'/);
  assert.match(migration, /status in \('in_transit', 'completed'\)[\s\S]*raise exception/);
});

test("all incoming readers use dispatched and partially received", () => {
  assert.match(reader, /"dispatched"[\s\S]*"partially_received"/);
  assert.doesNotMatch(reader, /"in_transit"|"completed"/);
  assert.match(replenishment, /RECEIVABLE_TRANSFER_QUERY_STATUSES/);
  assert.match(migration, /transfer\.status in \('dispatched', 'partially_received'\)/);
  assert.match(posInbox, /stockRequestId[\s\S]*receiveStockRequestAction[\s\S]*receiveStockTransferAction/);
});

test("authorized foundation test preserves direct history and updates request expectations", () => {
  assert.match(foundationTest, /historical direct retry does not fabricate transition operations/);
  assert.match(foundationTest, /historical receipt replay does not fabricate registry history/);
  assert.match(foundationTest, /request dispatch produces a canonical dispatched physical transfer/);
  assert.match(foundationTest, /request final receipt produces a canonical received physical transfer/);
  assert.match(foundationTest, /unknown transfer states are rejected/);
});
