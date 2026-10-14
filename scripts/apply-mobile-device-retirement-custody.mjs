import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { requireCanonicalProductionNeonTarget } from "./lib/canonical-production-neon-target.mjs";
import { restoreSql, runSql } from "./lib/phase-04-postgres-docker.mjs";

assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);
const rehearseOnly = process.argv.includes("--rehearse-only");
const migration = await readFile(new URL("../database/migrations/0018_mobile_device_retirement_custody.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /delete\s+from\s+(?:private\.pos_shift_custody_leases|public\.(?:sales|payments|receipts|inventory_movements|offline_sync_events))/i);

const installedSql = `select jsonb_build_object(
  'function',to_regprocedure('public.retire_pos_device(uuid,uuid,text,text,text)') is not null,
  'loss_decided_at',exists(select 1 from information_schema.columns where table_schema='private' and table_name='pos_shift_custody_leases' and column_name='loss_decided_at'),
  'loss_decided_by',exists(select 1 from information_schema.columns where table_schema='private' and table_name='pos_shift_custody_leases' and column_name='loss_decided_by_employee_id'),
  'loss_reason',exists(select 1 from information_schema.columns where table_schema='private' and table_name='pos_shift_custody_leases' and column_name='loss_reason')
)::text;`;
const installed = JSON.parse(runSql(databaseUrl, installedSql));
const installedValues = Object.values(installed);
assert.ok(installedValues.every(Boolean) || installedValues.every((value) => !value), "A44 migration is partially installed; stop for manual review.");

const evidenceSql = `select jsonb_build_object(
  'organizations',(select count(*) from public.organizations),
  'devices',(select count(*) from public.pos_devices),
  'custody_leases',(select count(*) from private.pos_shift_custody_leases),
  'sales',(select count(*) from public.sales),
  'payments',(select count(*) from public.payments),
  'receipts',(select count(*) from public.receipts),
  'inventory_movements',(select count(*) from public.inventory_movements),
  'offline_sync_events',(select count(*) from public.offline_sync_events)
)::text;`;
const before = JSON.parse(runSql(databaseUrl, evidenceSql));

if (!installedValues.every(Boolean)) {
  const rehearsal = migration.replace(/commit;\s*$/iu, "rollback;");
  assert.notEqual(rehearsal, migration, "A44 rehearsal could not replace the terminal commit.");
  restoreSql(databaseUrl, rehearsal);
  assert.equal(JSON.parse(runSql(databaseUrl, installedSql)).function, false, "A44 rehearsal did not roll back.");
  if (rehearseOnly) {
    assert.deepEqual(JSON.parse(runSql(databaseUrl, evidenceSql)), before, "A44 rehearsal changed protected rows.");
    console.log("A44 canonical migration rehearsal: PASS (ROLLED BACK)");
    console.log("Hosted Neon persistent changes: NONE");
    process.exit(0);
  }
  restoreSql(databaseUrl, migration);
}

if (rehearseOnly) {
  console.log("A44 canonical migration rehearsal: ALREADY INSTALLED");
  process.exit(0);
}

const after = JSON.parse(runSql(databaseUrl, evidenceSql));
assert.deepEqual(after, before, "A44 schema installation changed device, custody, financial, inventory, or sync rows.");
assert.equal(runSql(databaseUrl, "select to_regprocedure('public.retire_pos_device(uuid,uuid,text,text,text)') is not null;"), "t");
assert.equal(runSql(databaseUrl, "select has_function_privilege('tindio_authenticated','public.retire_pos_device(uuid,uuid,text,text,text)','execute');"), "t");
assert.equal(runSql(databaseUrl, `select count(*) from pg_proc proc cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where proc.oid='public.retire_pos_device(uuid,uuid,text,text,text)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE';`), "0");
assert.match(runSql(databaseUrl, "select pg_get_functiondef('public.revoke_pos_device(uuid,uuid,text)'::regprocedure);"), /requires an explicit transaction-custody decision/);
runSql(databaseUrl, "select pg_notify('pgrst', 'reload schema');");

console.log(`A44 canonical migration: ${installedValues.every(Boolean) ? "ALREADY_INSTALLED" : "REHEARSED_AND_APPLIED"}`);
console.log("Hosted Neon protected row counts unchanged: PASS");
console.log("Provider-neutral least-privilege retirement contract: PASS");
console.log("Data API schema reload requested: PASS");
