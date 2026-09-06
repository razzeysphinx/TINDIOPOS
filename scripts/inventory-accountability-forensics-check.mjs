import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [page, activity, detail, workflows, lifecycleMigration, offlineFoundation] = await Promise.all([
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../src/features/inventory/inventory-activity-list.tsx"),
  source("../src/features/inventory/inventory-product-detail.tsx"),
  source("../src/features/inventory/inventory-integrity-workflows.tsx"),
  source("../supabase/migrations/20260904021125_inventory_control_document_lifecycle.sql"),
  source("../src/features/offline/offline-sync.ts"),
]);

test("manual adjustments keep a review before the existing immutable document RPC", () => {
  assert.match(workflows, /function reviewAdjustment\(/);
  assert.match(workflows, />Review adjustment</);
  assert.match(workflows, /label="Current"/);
  assert.match(workflows, /label="Adjustment"/);
  assert.match(workflows, /label="Result"/);
  assert.match(workflows, /recordInventoryAdjustmentV2Action\(/);
  assert.match(lifecycleMigration, /create table if not exists public\.inventory_adjustments/);
  assert.match(lifecycleMigration, /source_id links every adjustment to this document/);
});

test("activity resolves canonical source documents without duplicating history", () => {
  for (const table of ["inventory_adjustments", "inventory_counts", "goods_receipts", "stock_transfers"]) {
    assert.match(page, new RegExp(`from\\(\\"${table}\\"\\)`));
  }
  assert.match(page, /sourceDocumentReferences/);
  assert.match(page, /Adjustment SA-/);
  assert.match(page, /Count IC-/);
  assert.match(page, /Receiving GR-/);
  assert.match(page, /Transfer TR-/);
  assert.match(page, /sourceReferenceForMovement/);
  assert.match(activity, />Source document</);
  assert.match(activity, /label="Note"/);
  assert.match(activity, /immutable inventory ledger record/);
});

test("negative stock is an investigation flow, not just a badge", () => {
  assert.match(detail, /Negative stock needs investigation before correction/);
  assert.match(detail, />View full activity</);
  assert.match(detail, />Start count</);
  assert.match(detail, /Last physical count/);
  assert.match(detail, /existing negative-stock policy/);
});

test("inventory sync conflicts are aggregated for visibility without changing replay behavior", () => {
  assert.match(page, /inventorySyncConflictsByStore/);
  assert.match(page, /offline inventory operation/);
  assert.match(page, /No stock correction is applied here/);
  assert.match(page, /href: "\/back-office\/offline-sync"/);
  assert.match(offlineFoundation, /withOfflineSyncLock/);
  assert.match(offlineFoundation, /activeSyncs/);
  assert.doesNotMatch(page, /retryOffline|reconcileInventory|apply_inventory_change_v2/);
});
