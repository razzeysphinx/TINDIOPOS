import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

const [contract, posData, posTypes, posInbox, inventoryPage, workflows] = await Promise.all([
  source("../src/features/inventory/inventory-transfer-reader-contract.ts"),
  source("../src/features/pos/data.ts"),
  source("../src/features/pos/pos-types.ts"),
  source("../src/features/pos/pos-incoming-transfer-inbox.tsx"),
  source("../src/app/(back-office)/back-office/inventory/page.tsx"),
  source("../src/features/inventory/inventory-integrity-workflows.tsx"),
]);

test("shared transitional reader contract encodes the Phase 05 discriminator", () => {
  assert.match(contract, /RECEIVABLE_TRANSFER_QUERY_STATUSES[\s\S]*"dispatched"[\s\S]*"in_transit"[\s\S]*"partially_received"/);
  assert.match(contract, /if \(stockRequestId\)[\s\S]*status === "in_transit" \|\| status === "partially_received"/);
  assert.match(contract, /return status === "dispatched"[\s\S]*status === "in_transit"[\s\S]*status === "partially_received"/);
  for (const terminal of ["draft", "submitted", "approved", "received", "cancelled", "completed"]) {
    assert.doesNotMatch(contract, new RegExp(`status === "${terminal}"`));
  }
});

test("POS uses the shared guard and type while preserving request routing", () => {
  assert.match(posData, /import \{ isReceivableTransferState \}/);
  assert.match(posData, /isReceivableTransferState\(transfer\.status, transfer\.stock_request_id\)/);
  assert.match(posTypes, /import type \{ ReceivableTransferStatus \}/);
  assert.match(posTypes, /status: ReceivableTransferStatus/);
  assert.match(posInbox, /stockRequestId[\s\S]*receiveStockRequestAction[\s\S]*receiveStockTransferAction/);
});

test("Back Office coarse query is guarded and direct receipt remains discriminated", () => {
  assert.match(inventoryPage, /RECEIVABLE_TRANSFER_QUERY_STATUSES/);
  assert.match(inventoryPage, /isReceivableTransferState\(transfer\.status, transfer\.stock_request_id\)/);
  assert.match(inventoryPage, /directInTransitTransfers = inTransitTransfers\.filter\(\(transfer\) => !transfer\.stockRequestId\)/);
  assert.match(workflows, /import type \{ ReceivableTransferStatus \}/);
  assert.match(workflows, /status: ReceivableTransferStatus/);
});
