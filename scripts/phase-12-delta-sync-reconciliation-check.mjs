import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("Phase 12 delta sync contract", () => {
  const schema = read("apps/mobile/src/db/schema.ts");
  const migration = read("archive/database/supabase-migrations/20260929010000_phase_12_delta_sync.sql");
  const pageLimitFix = read("database/migrations/0015_mobile_delta_catalog_page_limit.sql");
  const push = read("src/app/api/pos/v2/sync/push/route.ts");
  const pull = read("src/app/api/pos/v2/sync/pull/route.ts");
  const apply = read("apps/mobile/src/features/sync/apply-delta-page.ts");
  const cache = read("apps/mobile/src/db/cache-admin.ts");
  const outboxSync = read("apps/mobile/src/features/outbox/outbox-sync.ts");

  assert.ok(schema.includes("TINDIO_LOCAL_SCHEMA_VERSION = 13") && schema.includes("sync_cursors"));
  for (const text of [
    "pos_sync_changes",
    "bigint generated always as identity",
    "CATALOG",
    "REFERENCE",
    "CUSTOMER",
    "DEVICE",
    "MODIFIERS",
    "get_pos_sync_revision",
    "get_pos_sync_change_window",
    "get_pos_catalog_product_v2",
    "get_pos_sync_customer",
    "pos_sync_products",
    "pos_sync_customers",
    "pos_sync_devices",
  ]) assert.ok(migration.includes(text));

  assert.match(pageLimitFix, /private\.require_pos_sync_access/);
  assert.match(pageLimitFix, /'x-tindio-device-id'/);
  assert.doesNotMatch(pageLimitFix, /x-tindio-pos-device-id/);
  assert.match(pageLimitFix, /product\.organization_id = target_organization_id/);
  assert.match(pageLimitFix, /page_limit := least\(48, 10000 - page_offset\)/);
  assert.match(pageLimitFix, /public\.search_pos_catalog\([\s\S]*page_offset,[\s\S]*page_limit/);
  assert.match(pageLimitFix, /entry\.value ->> 'productId' = target_product_id::text/);
  assert.doesNotMatch(pageLimitFix, /search_pos_catalog\([^;]+10000\)/);

  assert.ok(push.includes("for(const event of parsed.data.events") && push.includes("stoppedEarly"));
  assert.ok(pull.includes("nextCursor") && pull.includes("store_id"));
  assert.match(pull, /function jsonRpcValue<T>/);
  assert.match(pull, /jsonRpcValue<\{items\?:PosCatalogDelta\["items"\]\}>\(answer\.data\)/);
  assert.match(pull, /jsonRpcValue<\{customer\?:PosCustomerDelta\["customer"\]\}>\(answer\.data\)/);
  assert.match(pull, /jsonRpcValue<PosReferenceV2Response>\(answer\.data\)/);
  assert.ok(apply.indexOf("applyDeltaSqliteTransaction") < apply.indexOf("advanceSyncCursor"));
  for (const text of ["outbox_events", "device_sync_state", "sync_cursors"]) assert.ok(cache.includes(text));
  for (const text of ["coordinateOutboxSync", "runOutboxSingleFlight", "validateSyncPushResponse", "OUTBOX_TRANSPORT_TIMEOUT_MS"]) assert.ok(outboxSync.includes(text));
  assert.doesNotMatch(read("apps/mobile/src/features/sync/reconcile-cloud.ts"), /setInterval|Promise\.all/);
});
