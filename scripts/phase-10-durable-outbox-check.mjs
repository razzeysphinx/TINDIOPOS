import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 10 durable outbox contract", () => {
  const schema = read("apps/mobile/src/db/schema.ts");
  const outbox = read("apps/mobile/src/db/outbox.ts");
  const acceptance = read("apps/mobile/src/features/outbox/create-offline-sale.ts");
  const sync = read("apps/mobile/src/features/outbox/outbox-sync.ts");
  const pos = read("apps/mobile/app/(app)/pos.tsx");
  const cacheAdmin = read("apps/mobile/src/db/cache-admin.ts");

  for (const text of ["TINDIO_LOCAL_SCHEMA_VERSION = 4", "outbox_events", "SALE_COMPLETED", "idx_outbox_pending"]) assert.ok(schema.includes(text));
  for (const text of ["withExclusiveTransactionAsync", "LOCAL_PENDING", "recoverInterruptedOutboxEvents", "getOldestUnresolvedOutboxEvent"]) assert.ok(outbox.includes(text));
  for (const text of ["validateOfflineAuthorizationGrant", "ELIGIBLE_CASH_PAYMENT_METHOD_REQUIRED", "Crypto.randomUUID", "OFF-"]) assert.ok(acceptance.includes(text));
  for (const text of ["/api/pos/v2/offline-checkout", "for (const event of events)", "loadMobileDeviceIdentity", "SYNCING", "CONFLICT", "FAILED"]) assert.ok(sync.includes(text));
  assert.ok(pos.includes("SAVE OFFLINE CASH SALE") && pos.includes("SAVED LOCALLY"));
  assert.ok(cacheAdmin.includes("outbox events are intentionally excluded"));
  assert.doesNotMatch(schema, /device_sequence|server_checkpoint|delta_cursor/i);
  assert.doesNotMatch(sync, /Promise\.all/);
});
