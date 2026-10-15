import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("A50 live rehearsal is explicit, canonical-source guarded, isolated, and read-only", () => {
  const source = read("scripts/mobile-a50-cloud-restore-reconciliation.mjs");

  assert.match(source, /TINDIO_A50_RESTORE_REHEARSAL/);
  assert.match(source, /requireCanonicalProductionNeonTarget/);
  assert.match(source, /A50 restore target must not be the canonical production endpoint/);
  assert.match(source, /TINDIO_A50_RESTORE_PARENT_BRANCH_ID/);
  assert.match(source, /a50-isolated-restore-/);
  assert.match(source, /runReadOnlySql/);
  assert.doesNotMatch(source, /runSql|restoreSql|DELETE FROM|DROP TABLE|TRUNCATE|UPDATE public|INSERT INTO/);
});

test("A50 compares protected financial, inventory, sync, and custody content", () => {
  const source = read("scripts/mobile-a50-cloud-restore-reconciliation.mjs");

  for (const table of [
    "public.sales",
    "public.sale_items",
    "public.payments",
    "public.receipts",
    "public.refunds",
    "public.refund_items",
    "public.refund_payments",
    "public.inventory_levels",
    "public.inventory_movements",
    "public.pos_device_sequence_receipts",
    "public.pos_device_sync_checkpoints",
    "private.pos_shift_custody_leases",
  ]) {
    assert.ok(source.includes(`"${table}"`), `${table} must be fingerprinted.`);
  }

  assert.match(source, /contentSha256/);
  assert.match(source, /financialTotals/);
  assert.match(source, /assertZeroRelationships/);
  assert.match(source, /saleItemsWithoutSale/);
  assert.match(source, /inventoryMovementMathErrors/);
  assert.match(source, /custodyLeasesWithoutDevice/);
});

test("A50 reports measured recovery time and recovery-point lag without business rows", () => {
  const source = read("scripts/mobile-a50-cloud-restore-reconciliation.mjs");

  assert.match(source, /recoveryTimeSeconds/);
  assert.match(source, /recoveryPointLagSeconds/);
  assert.match(source, /observedDataLossRows: 0/);
  assert.match(source, /rawBusinessRowsPersisted: false/);
  assert.match(source, /sourceWrites: 0/);
  assert.match(source, /restoreWrites: 0/);
});

test("A50 governance names Neon as business authority and keeps Supabase scoped to Auth", () => {
  const governance = read("docs/backup-recovery-and-data-governance.md");

  assert.match(governance, /authoritative business database is Neon Postgres/);
  assert.match(governance, /Supabase remains the authentication provider/);
  assert.match(governance, /Never rewind the primary\/default branch during a drill/);
  assert.match(governance, /device sequences, checkpoints, and unresolved custody/);
});
