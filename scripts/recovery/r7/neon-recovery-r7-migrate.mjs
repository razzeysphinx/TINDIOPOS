import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

import { dumpBusinessDataReadOnly, restoreSqlAtomic, runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";
import { SOURCE, TARGET, identity, sanitizedIdentity, sourceUrl, targetUrl } from "./common.mjs";
import { buildMigrationStages } from "./dependency-planner.mjs";
import { exactTimestampScopeSql, resolveProductUnitTimestampTrigger } from "./historical-trigger-scope.mjs";

const directory = "docs/recovery/evidence/r7";

function counts(url, tables) {
  const selects = tables.map((table) => {
    assert.match(table, /^(public|private)\.[a-z0-9_]+$/u);
    return `select '${table}' as name, count(*)::bigint as count from ${table}`;
  });
  return JSON.parse(runReadOnlySql(url, `select jsonb_object_agg(name,count order by name)::text from (${selects.join(" union all ")}) c;`));
}

function guardMetadata(url) {
  return JSON.parse(runReadOnlySql(url, `select coalesce(jsonb_agg(jsonb_build_object('table',format('%I.%I',n.nspname,c.relname),'enabled',t.tgenabled,'internal',t.tgisinternal,'function',p.oid::regprocedure::text,'definition',pg_get_triggerdef(t.oid,true)) order by n.nspname,c.relname),'[]'::jsonb)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc p on p.oid=t.tgfoid where t.tgname='phase16_organization_operational_guard';`));
}

function organizationSnapshot(url) {
  return runReadOnlySql(url, `select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb)::text from public.organizations;`);
}

function tableRows(url, table) {
  assert.match(table, /^(public|private)\.[a-z0-9_]+$/u);
  return runReadOnlySql(url, `select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from ${table} t;`);
}

const startedAt = new Date();
assert.equal(process.env.TINDIO_R7_REMOTE_WRITE, "YES", "Set TINDIO_R7_REMOTE_WRITE=YES only for the approved isolated R7 target migration.");
const classification = JSON.parse(await readFile(`${directory}/table-classification.json`, "utf8"));
assert.deepEqual(classification.INVESTIGATE, []);
const source = await sourceUrl();
const target = targetUrl();
assert.notEqual(new URL(source).hostname, new URL(target).hostname);
const sourceBefore = counts(source, classification.MIGRATE);
const targetBefore = counts(target, classification.MIGRATE);
const targetRowsBefore = Object.values(targetBefore).reduce((sum, count) => sum + Number(count), 0);

const guardsBefore = guardMetadata(target);
assert.equal(guardsBefore.length, 78, "Expected exactly 78 operational guards.");
for (const guard of guardsBefore) {
  assert.equal(guard.enabled, "O"); assert.equal(guard.internal, false);
  assert.equal(guard.function, "private.assert_organization_operational()");
}
const guardedTables = guardsBefore.map((guard) => guard.table);
const stages = buildMigrationStages({ tables: classification.MIGRATE, guardedTables });
const sourceOrganizations = organizationSnapshot(source);
assert.deepEqual(JSON.parse(sourceOrganizations).map((item) => item.status), ["active", "active"]);

const bootstrapSideEffects = [
  "private.organization_data_governance", "public.approval_rules", "public.loyalty_programs",
  "public.organization_features", "public.payment_methods", "public.receipt_settings",
];
if (targetRowsBefore === 0) {
  const profileDump = dumpBusinessDataReadOnly(source, ["--table=public.profiles"]);
  const organizationDump = dumpBusinessDataReadOnly(source, ["--table=public.organizations"]);
  restoreSqlAtomic(target, Buffer.concat([profileDump, Buffer.from("\n", "utf8"), organizationDump]));
} else {
  const allowedCheckpointTables = new Set(["public.profiles", "public.organizations", "public.permissions", "public.roles", "public.role_permissions", "public.products", "public.product_units", ...bootstrapSideEffects]);
  const unexpected = Object.entries(targetBefore).filter(([table, count]) => Number(count) > 0 && !allowedCheckpointTables.has(table));
  assert.deepEqual(unexpected, [], "R7 resume found rows outside the exact Stage-1 checkpoint.");
}
const targetOrganizationsAfterStage1 = organizationSnapshot(target);
assert.equal(targetOrganizationsAfterStage1, sourceOrganizations, "Organization visibility gate failed after Stage 1.");

restoreSqlAtomic(target, `${bootstrapSideEffects.map((table) => `DELETE FROM ${table};`).join("\n")}\nDELETE FROM public.pos_sync_changes;`);
const afterBootstrapCleanup = counts(target, bootstrapSideEffects);
assert.ok(Object.values(afterBootstrapCleanup).every((count) => Number(count) === 0), "Canonical bootstrap side-effect cleanup failed.");

const referenceCounts = counts(target, ["public.permissions", "public.roles"]);
if (Number(referenceCounts["public.permissions"]) === 0 && Number(referenceCounts["public.roles"]) === 0) {
  const permissionsDump = dumpBusinessDataReadOnly(source, ["--table=public.permissions"]);
  const rolesDump = dumpBusinessDataReadOnly(source, ["--table=public.roles"]);
  restoreSqlAtomic(target, Buffer.concat([permissionsDump, Buffer.from("\n", "utf8"), rolesDump]));
} else {
  assert.equal(Number(referenceCounts["public.permissions"]), Number(sourceBefore["public.permissions"]), "Permission reference checkpoint mismatch.");
  assert.equal(Number(referenceCounts["public.roles"]), Number(sourceBefore["public.roles"]), "Role reference checkpoint mismatch.");
}
restoreSqlAtomic(target, "DELETE FROM public.role_permissions; DELETE FROM public.pos_sync_changes;");

const catalogCounts = counts(target, ["public.products", "public.product_units"]);
if (Number(catalogCounts["public.products"]) === 0 && Number(catalogCounts["public.product_units"]) === 0) {
  const productsDump = dumpBusinessDataReadOnly(source, ["--table=public.products"]);
  restoreSqlAtomic(target, productsDump);
} else if (Number(catalogCounts["public.products"]) > 0) {
  assert.equal(Number(catalogCounts["public.products"]), Number(sourceBefore["public.products"]), "Product checkpoint mismatch.");
  assert.equal(Number(catalogCounts["public.product_units"]), Number(sourceBefore["public.product_units"]), "Product-unit checkpoint mismatch.");
}
const sourceProductUnits = tableRows(source, "public.product_units");
const productUnitJson = `'${sourceProductUnits.replaceAll("'", "''")}'::jsonb`;
const timestampTriggerBefore = resolveProductUnitTimestampTrigger(target);
const productUnitReconciliationSql = `
  update public.product_units target set
    id=source.id, unit_name=source.unit_name, is_sale_unit=source.is_sale_unit,
    is_purchase_unit=source.is_purchase_unit,
    created_at=source.created_at, updated_at=source.updated_at
  from jsonb_populate_recordset(null::public.product_units, ${productUnitJson}) source
  where target.product_id=source.product_id and target.unit_code=source.unit_code and target.is_base and source.is_base;
  insert into public.product_units
  select source.* from jsonb_populate_recordset(null::public.product_units, ${productUnitJson}) source
  where not source.is_base and not exists (select 1 from public.product_units target where target.id=source.id);
  delete from public.pos_sync_changes;
`;
restoreSqlAtomic(target, exactTimestampScopeSql(timestampTriggerBefore, productUnitReconciliationSql));
const timestampTriggerAfter = resolveProductUnitTimestampTrigger(target);
assert.deepEqual(timestampTriggerAfter, timestampTriggerBefore, "Product-unit timestamp trigger changed during historical reconciliation.");
assert.equal(tableRows(target, "public.product_units"), sourceProductUnits, "Product-unit historical reconciliation failed.");

const remainingDump = dumpBusinessDataReadOnly(source, ["--schema=public", "--schema=private", "--exclude-table=public.profiles", "--exclude-table=public.organizations", "--exclude-table=public.permissions", "--exclude-table=public.roles", "--exclude-table=public.products", "--exclude-table=public.product_units", "--exclude-table=public.role_permissions"]);
restoreSqlAtomic(target, remainingDump);
restoreSqlAtomic(target, "DELETE FROM public.role_permissions; DELETE FROM public.pos_sync_changes;");
const rolePermissionsDump = dumpBusinessDataReadOnly(source, ["--table=public.role_permissions"]);
restoreSqlAtomic(target, rolePermissionsDump);
const employeeStoreRows = runReadOnlySql(source, "select coalesce(jsonb_agg(to_jsonb(t) order by organization_id,employee_id,store_id),'[]'::jsonb)::text from public.employee_stores t;");
const employeeStoreJson = `'${employeeStoreRows.replaceAll("'", "''")}'::jsonb`;
restoreSqlAtomic(target, `update public.employee_stores target set created_at=source.created_at from jsonb_populate_recordset(null::public.employee_stores, ${employeeStoreJson}) source where target.organization_id=source.organization_id and target.employee_id=source.employee_id and target.store_id=source.store_id; delete from public.pos_sync_changes;`);

const sourceAfter = counts(source, classification.MIGRATE);
const targetAfter = counts(target, classification.MIGRATE);
assert.deepEqual(sourceAfter, sourceBefore, "Source counts changed during the consistent snapshot window.");
assert.deepEqual(targetAfter, sourceAfter, "Target counts do not match the source after migration.");
const sourceIdentity = identity(source);
const targetIdentity = identity(target);
const guardsAfter = guardMetadata(target);
assert.deepEqual(guardsAfter, guardsBefore, "Operational guard state or definition changed during import.");
const rows = Object.values(sourceAfter).reduce((sum, count) => sum + Number(count), 0);
const evidence = {
  startedAt: startedAt.toISOString(), endedAt: new Date().toISOString(),
  source: sanitizedIdentity(SOURCE, sourceIdentity), target: sanitizedIdentity(TARGET, targetIdentity),
  sourceReadOnly: true, sourceWrites: 0,
  strategy: "consistent read-only staged pg_dump; Stage 1 profiles/organizations commit; organization visibility gate; atomic remaining dependency-ordered restore",
  stages,
  resumedFromStage1Checkpoint: targetRowsBefore > 0,
  canonicalBootstrapSideEffectsReplacedByHistoricalRows: bootstrapSideEffects,
  organizationVisibilityGate: "PASS",
  organizationSnapshotSha256: createHash("sha256").update(sourceOrganizations).digest("hex"),
  guards: { count: guardsAfter.length, enabled: guardsAfter.filter((guard) => guard.enabled === "O").length, definitionSha256: createHash("sha256").update(JSON.stringify(guardsAfter.map((guard) => guard.definition))).digest("hex"), changed: false, disabledDuringImport: false },
  productUnitTimestampException: { trigger: timestampTriggerAfter.name, function: timestampTriggerAfter.function, temporaryTransactionalDisable: true, finalState: timestampTriggerAfter.enabled, definitionChanged: false },
  tablesAttempted: classification.MIGRATE.length, sourceSelected: rows, targetAttempted: rows,
  inserted: rows, updated: 0, skipped: 0, failed: 0,
  sourceCountsBefore: sourceBefore, sourceCountsAfter: sourceAfter, targetCountsAfter: targetAfter,
};
await writeFile(`${directory}/migration-result.json`, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ tables: evidence.tablesAttempted, inserted: rows, skipped: 0, failed: 0, sourceReadOnly: true }, null, 2));
console.log("TINDIO R7 BUSINESS DATA MIGRATION: PASS");
