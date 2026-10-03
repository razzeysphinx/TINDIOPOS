import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("Phase 15 Slice 03 store-local coordination", () => {
  const sync = fs.readFileSync(
    "apps/mobile/src/features/store-hub/store-hub-sync.ts",
    "utf8",
  );
  const inventory = fs.readFileSync(
    "apps/mobile/src/features/inventory/offline-inventory-intelligence.ts",
    "utf8",
  );
  const outbox = fs.readFileSync(
    "apps/mobile/src/features/outbox/outbox-types.ts",
    "utf8",
  );

  for (const marker of [
    "publishStoreHubEvent",
    "pullStoreHubChanges",
    "store_hub_publish_state",
    "cloudSyncedAt",
  ]) {
    assert.ok(sync.includes(marker), `sync must include ${marker}`);
  }

  assert.ok(
    sync.includes('row.state === "SYNCED"'),
    "Hub must learn when local cloud state later becomes synced",
  );

  for (const marker of [
    "peerStoreLocalActivity",
    "peerDeviceCount",
    "STORE_LOCAL_AWARE",
    "readPeerStoreLocalInventoryActivity",
  ]) {
    assert.ok(
      inventory.includes(marker),
      `inventory must include ${marker}`,
    );
  }

  assert.equal(
    /export type OutboxOperationType\s*=\s*"SALE_COMPLETED"/.test(outbox),
    true,
    "Store Hub coordination must not expand cloud outbox types",
  );

  assert.doesNotMatch(
    sync,
    /updateOutboxEvent|state:\s*"SYNCED"/,
    "Store Hub ACK must never mark cloud outbox events synced",
  );
});
