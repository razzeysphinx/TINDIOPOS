import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const routes = {
  customers: read("apps/mobile/app/(app)/customers.tsx"),
  receipts: read("apps/mobile/app/(app)/receipts.tsx"),
  receipt: read("apps/mobile/app/(app)/receipt/[receiptId].tsx"),
  shift: read("apps/mobile/app/(app)/shift.tsx"),
  tickets: read("apps/mobile/app/(app)/tickets.tsx"),
  transfers: read("apps/mobile/app/(app)/transfers.tsx"),
  timeClock: read("apps/mobile/app/(app)/time-clock.tsx"),
  sync: read("apps/mobile/app/(app)/sync-status.tsx"),
  settings: read("apps/mobile/app/(app)/settings.tsx"),
};
const workspace = read("apps/mobile/src/ui/tindio-workspace.tsx");
const layout = read("apps/mobile/app/(app)/_layout.tsx");

test("Slice 12 gives supporting cashier workflows one shared operational hierarchy", () => {
  for (const [name, source] of Object.entries(routes)) {
    assert.match(source, /Tindio(Screen|WorkspaceHeader|WorkspaceSection|Card)/, `${name} must use shared native presentation`);
  }
  for (const marker of ["TindioWorkspaceHeader", "TindioWorkspaceSection", "TindioListItem", "TindioKeyValue", "accessibilityState", "tindioTheme.target.minimum"]) {
    assert.match(workspace, new RegExp(marker));
  }
  assert.doesNotMatch(workspace, /fetchPosV2|openPosV2|closePosV2|receivePosV2|clockInPosV2|DELETE FROM/);
});

test("Slice 12 keeps online-only and permission boundaries explicit", () => {
  assert.match(routes.customers, /mode === "online"/);
  assert.match(routes.customers, /customers\.manage/);
  assert.match(routes.receipts, /receipts\.view/);
  assert.match(routes.receipt, /sales\.refund/);
  assert.match(routes.receipt, /receipts\.reprint/);
  for (const source of [routes.shift, routes.tickets, routes.transfers, routes.timeClock]) {
    assert.match(source, /mode (?:===|!==) "online"|mode === "offline"/);
    assert.match(source, /online only|require(?:s)? a connection/i);
  }
  assert.match(layout, /"\/a45-certification"/);
  assert.match(layout, /devices\.manage/);
  assert.match(layout, /settings\.manage/);
});

test("Slice 12 preserves stable operation identity and prevents duplicate activation", () => {
  assert.match(routes.shift, /movementAttempt\?\.signature === signature[\s\S]*movementAttempt\.key/);
  assert.match(routes.shift, /if \(movementPending/);
  assert.match(routes.transfers, /operationId/);
  assert.match(routes.transfers, /if \(receiving/);
  assert.match(routes.timeClock, /attempt\?\.signature === signature[\s\S]*attempt\.key/);
  assert.match(routes.timeClock, /if \(pendingAction/);
  assert.match(routes.receipt, /idempotencyKey: deliveryKey/);
  assert.match(routes.receipt, /idempotencyKey: refundKey/);
  assert.match(routes.receipt, /if \(deliveryPending/);
  assert.match(routes.receipt, /refundPending/);
  assert.match(routes.tickets, /if \(pendingAction\) return/);
});

test("Slice 12 preserves custody, store scope, and supervised recovery", () => {
  assert.match(routes.receipts, /searchLocalReceipts\(core\.organization\.id, core\.storeIds/);
  assert.match(routes.receipts, /searchCachedReceiptSummaries\(core\.organization\.id, core\.storeIds/);
  assert.match(routes.shift, /prepareShiftFinalization/);
  assert.match(routes.shift, /completeShiftFinalizationGuard/);
  assert.match(routes.settings, /canReleaseTransactionCustody/);
  assert.match(routes.settings, /retained as a recovery path/);
  assert.match(routes.sync, /retryReviewedOutboxEvent/);
  assert.match(routes.sync, /Retry original transaction/);
  assert.match(routes.sync, /Authorized diagnostics/);
  for (const source of Object.values(routes)) assert.doesNotMatch(source, /clearDatabase|resetDatabase|DELETE FROM|DROP TABLE/);
});
