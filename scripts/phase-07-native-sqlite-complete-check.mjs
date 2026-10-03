import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");
const dbFiles = [
  "apps/mobile/src/db/schema.ts",
  "apps/mobile/src/db/database.ts",
  "apps/mobile/src/db/business-context-cache.ts",
  "apps/mobile/src/db/cache-state.ts",
  "apps/mobile/src/db/reference-cache.ts",
  "apps/mobile/src/db/catalog-cache.ts",
  "apps/mobile/src/db/customer-cache.ts",
  "apps/mobile/src/db/shift-cache.ts",
  "apps/mobile/src/db/receipt-cache.ts",
  "apps/mobile/src/db/cache-admin.ts",
  "apps/mobile/src/db/cache-stats.ts",
  "apps/mobile/src/db/health.ts",
];

test("Phase 07 complete foundation remains persistent, tenant-scoped, and phase-bounded", () => {
  const schema = read("apps/mobile/src/db/schema.ts");
  const database = read("apps/mobile/src/db/database.ts");
  const provider = read("apps/mobile/src/features/business/business-context-provider.tsx");
  const onlineCache = read("apps/mobile/src/features/storage/cache-online-results.ts");
  const health = read("apps/mobile/src/db/health.ts");
  const sync = read("apps/mobile/app/(app)/sync-status.tsx");
  const localSource = dbFiles.map(read).join("\n");

  assert.match(schema, /TINDIO_LOCAL_SCHEMA_VERSION\s*=\s*7/);
  assert.match(schema, /version:\s*1/);
  assert.match(schema, /version:\s*2/);
  for (const table of ["local_metadata", "business_context_snapshots", "local_cache_state", "reference_snapshots", "catalog_items", "customer_cache", "shift_snapshots", "receipt_summaries"]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  for (const table of ["business_context_snapshots", "local_cache_state", "reference_snapshots", "catalog_items", "customer_cache", "shift_snapshots", "receipt_summaries"]) {
    const statement = schema.slice(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`), schema.indexOf(";", schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`)));
    assert.match(statement, /organization_id/);
  }
  for (const table of ["catalog_items", "customer_cache"]) {
    const statement = schema.slice(schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`), schema.indexOf(";", schema.indexOf(`CREATE TABLE IF NOT EXISTS ${table}`)));
    assert.match(statement, /store_id/);
  }
  for (const index of ["idx_catalog_lookup_barcode", "idx_catalog_lookup_sku", "idx_catalog_category", "idx_catalog_product_name"]) assert.match(schema, new RegExp(index));
  assert.match(provider, /saveBusinessContextSnapshot/);
  assert.match(provider, /saveActiveShiftSnapshot/);
  for (const helper of ["refreshReferenceCache", "fetchAndCacheCatalogPage", "fetchAndCacheCustomers", "fetchAndCacheReceipts"]) assert.match(onlineCache, new RegExp(helper));
  for (const requirement of ["PRAGMA quick_check", "closeTindioDatabase", "armPhase07RestartProof", "readPhase07RestartProof"]) assert.match(health, new RegExp(requirement));
  assert.match(database, /WAL/);
  assert.match(database, /foreign_keys/);
  for (const phase of ["Phase 08", "Phase 09", "PHASE 10", "PHASE 11", "PHASE 12"]) assert.match(sync, new RegExp(phase));
  for (const table of ["outbox_events", "device_sync_state", "sync_cursors", "store_hub_state"]) assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.doesNotMatch(localSource, /(access_token|refresh_token|credential\.secret|device\.secret|DATABASE_URL|DATABASE_URL_UNPOOLED|service_role)/i);
});
