import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import process from "node:process";

import {
  dumpBusinessDataReadOnly,
  runReadOnlySql,
} from "./lib/phase-04-postgres-docker.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  assert.ok(value, `${name} is required.`);
  return value;
}

function directNeonUrl(name) {
  const value = required(name);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:", `${name} must use PostgreSQL.`);
  assert.ok(parsed.hostname.endsWith(".neon.tech"), `${name} must target Neon.`);
  assert.ok(!parsed.hostname.includes("-pooler"), `${name} must use a direct endpoint.`);
  return { parsed, value };
}

const source = directNeonUrl("TINDIO_STAGING_SOURCE_DATABASE_URL");
const restore = directNeonUrl("TINDIO_STAGING_RESTORE_DATABASE_URL");
assert.equal(required("TINDIO_STAGING_RESTORE_REHEARSAL"), "YES");
assert.notEqual(restore.parsed.hostname, source.parsed.hostname, "Restore must use a separate endpoint.");
assert.equal(restore.parsed.pathname, source.parsed.pathname, "Restore must use the staging database name.");

const sourceBranch = required("TINDIO_STAGING_SOURCE_BRANCH_ID");
const restoreBranch = required("TINDIO_STAGING_RESTORE_BRANCH_ID");
assert.match(sourceBranch, /^br-[a-z0-9-]+$/u);
assert.match(restoreBranch, /^br-[a-z0-9-]+$/u);
assert.notEqual(restoreBranch, sourceBranch);

const dumpArguments = [
  "--schema=public",
  "--schema=private",
];
const sourceDump = dumpBusinessDataReadOnly(source.value, dumpArguments);
const restoreDump = dumpBusinessDataReadOnly(restore.value, dumpArguments);
const stableDump = (value) => Buffer.from(
  value
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => !/^\\(?:un)?restrict\s/u.test(line))
    .join("\n"),
);
const digest = (value) => createHash("sha256").update(value).digest("hex");

const summarySql = `select jsonb_build_object(
  'sales', (select count(*) from public.sales),
  'saleTotalMinor', (select coalesce(sum(total_minor), 0) from public.sales),
  'payments', (select count(*) from public.payments),
  'paymentTotalMinor', (select coalesce(sum(amount_minor), 0) from public.payments),
  'receipts', (select count(*) from public.receipts),
  'refunds', (select count(*) from public.refunds),
  'refundTotalMinor', (select coalesce(sum(total_minor), 0) from public.refunds),
  'inventoryMovements', (select count(*) from public.inventory_movements),
  'inventoryQuantity', (select coalesce(sum(quantity), 0) from public.inventory_levels),
  'orphanSaleItems', (select count(*) from public.sale_items child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
  'orphanPayments', (select count(*) from public.payments child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
  'orphanReceipts', (select count(*) from public.receipts child left join public.sales parent on parent.id = child.sale_id and parent.organization_id = child.organization_id where parent.id is null),
  'inventoryMathErrors', (select count(*) from public.inventory_movements where quantity_after <> quantity_before + quantity_delta)
)::text;`;

const sourceSummary = JSON.parse(runReadOnlySql(source.value, summarySql));
const restoreSummary = JSON.parse(runReadOnlySql(restore.value, summarySql));
const stableSourceDump = stableDump(sourceDump);
const stableRestoreDump = stableDump(restoreDump);
const sourceDigest = digest(stableSourceDump);

assert.equal(digest(stableRestoreDump), sourceDigest, "Restored business data differs from staging.");
assert.deepEqual(restoreSummary, sourceSummary, "Restored financial/inventory summary differs from staging.");

for (const key of ["orphanSaleItems", "orphanPayments", "orphanReceipts", "inventoryMathErrors"]) {
  assert.equal(Number(sourceSummary[key]), 0, `${key} must be zero.`);
}

console.log(JSON.stringify({
  status: "PASS",
  sourceBranch,
  restoreBranch,
  exactBusinessDataSha256: sourceDigest,
  dumpBytes: stableSourceDump.length,
  financialAndInventorySummary: sourceSummary,
  sourceWrites: 0,
  restoreWrites: 0,
  rawBusinessRowsPersisted: false,
}, null, 2));
console.log("TINDIO STAGING RESTORE RECONCILIATION: PASS");
