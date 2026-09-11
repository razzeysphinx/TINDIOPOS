import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("POS incoming-transfer query is capability- and destination-store-scoped", async () => {
  const migration = await source("../supabase/migrations/20260911012610_pos_incoming_transfer_inbox.sql");

  assert.match(migration, /public\.get_pos_incoming_stock_transfers/);
  assert.match(migration, /\(select auth\.uid\(\)\) is not null/);
  assert.match(migration, /private\.has_inventory_capability[\s\S]*inventory\.transfer\.receive/);
  assert.match(migration, /private\.has_store_read_scope[\s\S]*transfer\.destination_store_id/);
  assert.match(migration, /public\.organization_features feature/);
  assert.match(migration, /feature\.feature_key in \('inventory', 'transfers'\)/);
  assert.match(migration, /transfer\.status in \('in_transit', 'partially_received'\)/);
  assert.match(migration, /revoke all on function public\.get_pos_incoming_stock_transfers/);
  assert.match(migration, /grant execute on function public\.get_pos_incoming_stock_transfers[\s\S]*authenticated/);
  assert.doesNotMatch(migration, /insert into public\.|update public\.|delete from public\./i);
});

test("POS inbox reuses canonical receipt actions and never queues inventory receiving offline", async () => {
  const inbox = await source("../src/features/pos/pos-incoming-transfer-inbox.tsx");

  assert.match(inbox, /receiveStockTransferAction/);
  assert.match(inbox, /receiveStockRequestAction/);
  assert.match(inbox, /getInventoryOperationId/);
  assert.match(inbox, /clearInventoryOperationId/);
  assert.match(inbox, /if \(!selectedTransfer \|\| !online\) return/);
  assert.match(inbox, /navigator\.onLine/);
  assert.match(inbox, /Transfer receipts need an internet connection/);
  assert.match(inbox, /Dialog\.Root modal=\{false\}/);
  assert.match(inbox, /nonBlocking/);
  assert.match(inbox, /window\.addEventListener\("online", refreshFromServer\)/);
  assert.match(inbox, /window\.addEventListener\("focus", refreshFromServer\)/);
  assert.match(inbox, /router\.refresh\(\)/);
  assert.doesNotMatch(inbox, /queueOffline|offline-checkout|cachePosCatalog/);
});

test("shared POS header exposes incoming transfers without adding a duplicate POS navigation route", async () => {
  const [header, drawer, data, ...pages] = await Promise.all([
    source("../src/features/pos/pos-workspace-header.tsx"),
    source("../src/features/pos/pos-operational-drawer.tsx"),
    source("../src/features/pos/data.ts"),
    source("../src/app/(pos)/pos/page.tsx"),
    source("../src/app/(pos)/pos/items/page.tsx"),
    source("../src/app/(pos)/pos/receipts/page.tsx"),
    source("../src/app/(pos)/pos/receipts/[receiptId]/page.tsx"),
    source("../src/app/(pos)/pos/settings/page.tsx"),
    source("../src/app/(pos)/pos/shifts/page.tsx"),
  ]);

  assert.match(header, /PosIncomingTransferInbox/);
  assert.match(header, /canReceiveIncomingTransfers/);
  assert.match(header, /incomingTransfers/);
  assert.doesNotMatch(drawer, /href: "\/pos\/transfers"/);
  assert.match(data, /get_pos_incoming_stock_transfers/);
  assert.match(data, /hasPermission\(context, "inventory\.transfer\.receive"\)/);
  assert.match(data, /canReceiveIncomingTransfers/);

  for (const page of pages) {
    assert.match(page, /canReceiveIncomingTransfers=\{workspace\.canReceiveIncomingTransfers\}/);
    assert.match(page, /incomingTransfers=\{workspace\.incomingTransfers\}/);
  }
});
