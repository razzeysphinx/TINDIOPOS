import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [page, workflows, transferWorkspace, migration] = await Promise.all([
  source("../src/app/(back-office)/back-office/replenishment/page.tsx"),
  source("../src/features/inventory/supply-chain-workflows.tsx"),
  source("../src/features/inventory/inventory-transfer-workspace.tsx"),
  source("../supabase/migrations/20260905090400_inventory_transfer_chain_of_custody.sql"),
]);

test("transfer creation keeps source, destination, and in-transit positions distinct", () => {
  assert.match(workflows, /Source on hand/);
  assert.match(workflows, /Destination on hand/);
  assert.match(workflows, /label="In transit"/);
  assert.match(page, /quantity.*received_quantity.*short_quantity/);
  assert.match(page, /inTransitBySaleable/);
  assert.match(page, /destination_store_id/);
});

test("canonical request lifecycle and discrepancy evidence are visible", () => {
  for (const stage of ["Requested", "Approved", "Picked", "Sent", "Received"]) {
    assert.match(workflows, new RegExp(stage));
  }
  assert.match(page, /stock_request_discrepancies/);
  assert.match(workflows, /Transfer requires attention/);
  assert.match(workflows, /remain in transit/);
  assert.match(workflows, /remain in the audit trail/);
  assert.match(transferWorkspace, /destination stock changes only when the receiving store confirms it/);
});

test("inventory actor follows central store scope without weakening capabilities", () => {
  assert.match(migration, /private\.has_store_read_scope\(target_organization_id, target_store_id\)/);
  assert.match(migration, /employee\.status = 'active'/);
  assert.match(migration, /employee\.profile_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(migration, /join public\.employee_stores/);
  assert.match(migration, /private\.has_permission\(organization_id, 'inventory\.manage'\)/);
});

test("transfer child records inherit parent store scope", () => {
  assert.match(migration, /private\.has_stock_transfer_read_scope\(organization_id, stock_transfer_id\)/);
  assert.match(migration, /private\.has_stock_request_read_scope\(organization_id, stock_request_id\)/);
  assert.match(migration, /stock_transfer_receipt_lines_select_manager/);
  assert.match(migration, /stock_request_discrepancies_select_inventory_manager/);
});

test("restock suggestions require user action and never mutate stock automatically", () => {
  assert.match(workflows, /Suggested transfer:/);
  assert.match(workflows, /Prepare transfer request/);
  assert.match(workflows, /never create a transfer or purchase order automatically/);
  assert.doesNotMatch(workflows, /ship_stock_transfer|apply_inventory_change_v2/);
});
