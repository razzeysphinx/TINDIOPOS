import assert from "node:assert/strict";
import process from "node:process";

import { runReadOnlySql } from "./lib/phase-04-postgres-docker.mjs";
import {
  CANONICAL_PRODUCTION_NEON_TARGET,
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";

const RESTORE_NAME_PREFIX = "a50-isolated-restore-";
const PROTECTED_TABLES = Object.freeze([
  "public.organizations",
  "public.stores",
  "public.registers",
  "public.products",
  "public.product_variants",
  "public.shifts",
  "public.sales",
  "public.sale_items",
  "public.payments",
  "public.receipts",
  "public.refunds",
  "public.refund_items",
  "public.refund_payments",
  "public.checkout_requests",
  "public.refund_requests",
  "public.inventory_levels",
  "public.inventory_movements",
  "public.pos_devices",
  "public.pos_device_sequence_receipts",
  "public.pos_device_sync_checkpoints",
  "private.pos_shift_custody_leases",
]);

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function restoreTarget(value) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:", "A50 restore target must use PostgreSQL.");
  assert.ok(parsed.hostname.endsWith(".neon.tech"), "A50 restore target must be Neon.");
  assert.ok(!parsed.hostname.includes("-pooler"), "A50 reconciliation requires a direct Neon endpoint.");
  assert.notEqual(
    parsed.hostname,
    CANONICAL_PRODUCTION_NEON_TARGET.hostname,
    "A50 restore target must not be the canonical production endpoint.",
  );
  assert.equal(
    decodeURIComponent(parsed.pathname.slice(1)),
    CANONICAL_PRODUCTION_NEON_TARGET.databaseName,
    "A50 restore target must contain the canonical TINDIO database.",
  );
  return value;
}

function tableFingerprintSql(table) {
  assert.match(table, /^(public|private)\.[a-z0-9_]+$/u);
  return `select '${table}' as table_name,
    count(*)::bigint as row_count,
    encode(extensions.digest(coalesce(string_agg(to_jsonb(t)::text, E'\\n' order by to_jsonb(t)::text), ''), 'sha256'), 'hex') as content_sha256
    from ${table} t`;
}

function snapshotSql() {
  const tableUnion = PROTECTED_TABLES.map(tableFingerprintSql).join(" union all ");

  return `
    select jsonb_build_object(
      'database', current_database(),
      'transactionReadOnly', current_setting('transaction_read_only')::boolean,
      'tables', (
        select jsonb_object_agg(
          table_name,
          jsonb_build_object('rowCount', row_count, 'contentSha256', content_sha256)
          order by table_name
        )
        from (${tableUnion}) table_fingerprints
      ),
      'financialTotals', jsonb_build_object(
        'saleTotalMinor', (select coalesce(sum(total_minor), 0) from public.sales),
        'paymentAmountMinor', (select coalesce(sum(amount_minor), 0) from public.payments),
        'refundTotalMinor', (select coalesce(sum(total_minor), 0) from public.refunds),
        'refundPaymentAmountMinor', (select coalesce(sum(amount_minor), 0) from public.refund_payments),
        'inventoryQuantity', (select coalesce(sum(quantity), 0) from public.inventory_levels),
        'inventoryMovementDelta', (select coalesce(sum(quantity_delta), 0) from public.inventory_movements),
        'inventoryValueDeltaMinor', (select coalesce(sum(value_delta_minor), 0) from public.inventory_movements)
      ),
      'relationships', jsonb_build_object(
        'unvalidatedForeignKeys', (select count(*) from pg_constraint where contype = 'f' and not convalidated),
        'saleItemsWithoutSale', (select count(*) from public.sale_items child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
        'paymentsWithoutSale', (select count(*) from public.payments child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
        'receiptsWithoutSale', (select count(*) from public.receipts child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
        'refundsWithoutSale', (select count(*) from public.refunds child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
        'refundItemsWithoutRefund', (select count(*) from public.refund_items child left join public.refunds parent on parent.id = child.refund_id and parent.organization_id = child.organization_id where parent.id is null),
        'refundItemsWithoutSaleItem', (select count(*) from public.refund_items child left join public.sale_items parent on parent.id = child.sale_item_id and parent.organization_id = child.organization_id where parent.id is null),
        'refundPaymentsWithoutRefund', (select count(*) from public.refund_payments child left join public.refunds parent on parent.id = child.refund_id and parent.organization_id = child.organization_id where parent.id is null),
        'saleShiftScopeMismatches', (select count(*) from public.sales child join public.shifts parent on parent.id = child.shift_id where child.organization_id <> parent.organization_id or child.store_id <> parent.store_id or child.register_id <> parent.register_id),
        'refundShiftScopeMismatches', (select count(*) from public.refunds child join public.shifts parent on parent.id = child.shift_id where child.organization_id <> parent.organization_id or child.store_id <> parent.store_id or child.register_id <> parent.register_id),
        'crossOrganizationInventory', (select count(*) from public.inventory_levels level join public.stores store on store.id = level.store_id join public.products product on product.id = level.product_id where level.organization_id <> store.organization_id or level.organization_id <> product.organization_id),
        'inventoryMovementMathErrors', (select count(*) from public.inventory_movements where quantity_after <> quantity_before + quantity_delta),
        'saleMovementsWithoutSale', (select count(*) from public.inventory_movements movement left join public.sales sale on sale.id = movement.source_id and sale.organization_id = movement.organization_id where lower(movement.source_type) = 'sale' and sale.id is null),
        'refundMovementsWithoutRefund', (select count(*) from public.inventory_movements movement left join public.refunds refund on refund.id = movement.source_id and refund.organization_id = movement.organization_id where lower(movement.source_type) = 'refund' and refund.id is null),
        'sequenceReceiptsWithoutDevice', (select count(*) from public.pos_device_sequence_receipts receipt left join public.pos_devices device on device.id = receipt.device_id and device.organization_id = receipt.organization_id where device.id is null),
        'syncCheckpointsWithoutDevice', (select count(*) from public.pos_device_sync_checkpoints checkpoint left join public.pos_devices device on device.id = checkpoint.device_id and device.organization_id = checkpoint.organization_id where device.id is null),
        'custodyLeasesWithoutDevice', (select count(*) from private.pos_shift_custody_leases lease left join public.pos_devices device on device.id = lease.device_id and device.organization_id = lease.organization_id where device.id is null)
      )
    )::text;
  `;
}

function readSnapshot(url) {
  return JSON.parse(runReadOnlySql(url, snapshotSql()));
}

function assertZeroRelationships(relationships) {
  const failures = Object.entries(relationships).filter(([, value]) => Number(value) !== 0);
  assert.deepEqual(failures, [], `Relationship reconciliation failed: ${failures.map(([name, value]) => `${name}=${value}`).join(", ")}`);
}

assert.equal(
  required("TINDIO_A50_RESTORE_REHEARSAL"),
  "YES",
  "A50 requires explicit isolated restore rehearsal authorization.",
);
assert.equal(required("TINDIO_A50_RESTORE_PROJECT_ID"), CANONICAL_PRODUCTION_NEON_TARGET.projectId);
assert.equal(required("TINDIO_A50_RESTORE_PARENT_BRANCH_ID"), CANONICAL_PRODUCTION_NEON_TARGET.branchId);
assert.match(required("TINDIO_A50_RESTORE_BRANCH_ID"), /^br-[a-z0-9-]+$/u);
assert.ok(required("TINDIO_A50_RESTORE_BRANCH_NAME").startsWith(RESTORE_NAME_PREFIX));

const startedAt = new Date(required("TINDIO_A50_STARTED_AT"));
const recoveryPoint = new Date(required("TINDIO_A50_RECOVERY_POINT"));
assert.ok(Number.isFinite(startedAt.valueOf()), "A50 start time must be ISO-8601.");
assert.ok(Number.isFinite(recoveryPoint.valueOf()), "A50 recovery point must be ISO-8601.");
assert.ok(recoveryPoint <= new Date(), "A50 recovery point cannot be in the future.");

const sourceUrl = requireCanonicalProductionNeonTarget(required("TINDIO_A50_SOURCE_DATABASE_URL")).databaseUrl;
const restoredUrl = restoreTarget(required("TINDIO_A50_RESTORE_DATABASE_URL"));
const source = readSnapshot(sourceUrl);
const restored = readSnapshot(restoredUrl);

assert.equal(source.database, CANONICAL_PRODUCTION_NEON_TARGET.databaseName);
assert.equal(restored.database, CANONICAL_PRODUCTION_NEON_TARGET.databaseName);
assert.equal(source.transactionReadOnly, true);
assert.equal(restored.transactionReadOnly, true);
assert.deepEqual(restored.tables, source.tables, "Protected table contents differ from the canonical recovery point.");
assert.deepEqual(restored.financialTotals, source.financialTotals, "Financial or inventory totals differ after restore.");
assert.deepEqual(restored.relationships, source.relationships, "Relationship evidence differs after restore.");
assertZeroRelationships(source.relationships);
assertZeroRelationships(restored.relationships);

const completedAt = new Date();
const recoveryTimeSeconds = Math.max(0, (completedAt.valueOf() - startedAt.valueOf()) / 1000);
const recoveryPointLagSeconds = Math.max(0, (startedAt.valueOf() - recoveryPoint.valueOf()) / 1000);

console.log(JSON.stringify({
  status: "PASS",
  generatedAt: completedAt.toISOString(),
  source: {
    projectId: CANONICAL_PRODUCTION_NEON_TARGET.projectId,
    branchId: CANONICAL_PRODUCTION_NEON_TARGET.branchId,
    database: source.database,
  },
  restore: {
    projectId: required("TINDIO_A50_RESTORE_PROJECT_ID"),
    branchId: required("TINDIO_A50_RESTORE_BRANCH_ID"),
    branchName: required("TINDIO_A50_RESTORE_BRANCH_NAME"),
    parentBranchId: required("TINDIO_A50_RESTORE_PARENT_BRANCH_ID"),
    database: restored.database,
    recoveryPoint: recoveryPoint.toISOString(),
  },
  recoveryTimeSeconds,
  recoveryPointLagSeconds,
  observedDataLossRows: 0,
  protectedTableCount: PROTECTED_TABLES.length,
  tableFingerprints: restored.tables,
  financialTotals: restored.financialTotals,
  relationships: restored.relationships,
  sourceWrites: 0,
  restoreWrites: 0,
  rawBusinessRowsPersisted: false,
}, null, 2));
console.log("MOB-10 A50 ISOLATED CLOUD RESTORE RECONCILIATION: PASS");
