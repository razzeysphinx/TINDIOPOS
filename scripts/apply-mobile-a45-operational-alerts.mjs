import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { requireCanonicalProductionNeonTarget } from "./lib/canonical-production-neon-target.mjs";
import { restoreSql, runSql } from "./lib/phase-04-postgres-docker.mjs";

assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);
const rehearseOnly = process.argv.includes("--rehearse-only");
const migration = await readFile(new URL("../database/migrations/0019_mobile_a45_operational_alerts.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /delete\s+from\s+(?:public\.(?:sales|payments|receipts|inventory_movements|offline_sync_events)|private\.pos_shift_custody_leases)/i);

const installedSql = `select jsonb_build_object(
  'table',to_regclass('public.pos_operational_alerts') is not null,
  'anr_count',exists(select 1 from information_schema.columns where table_schema='public' and table_name='pos_device_sync_telemetry' and column_name='anr_count'),
  'list_rpc',to_regprocedure('public.list_pos_operational_alerts(uuid)') is not null,
  'ack_rpc',to_regprocedure('public.acknowledge_pos_operational_alert(uuid,uuid)') is not null
)::text;`;
const installed = JSON.parse(runSql(databaseUrl, installedSql));
const installedValues = Object.values(installed);
assert.ok(installedValues.every(Boolean) || installedValues.every((value) => !value), "A45 migration is partially installed; stop for manual review.");

const evidenceSql = `select jsonb_build_object(
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
  assert.notEqual(rehearsal, migration);
  restoreSql(databaseUrl, rehearsal);
  assert.equal(JSON.parse(runSql(databaseUrl, installedSql)).table, false, "A45 rehearsal did not roll back.");
  if (rehearseOnly) {
    assert.deepEqual(JSON.parse(runSql(databaseUrl, evidenceSql)), before);
    console.log("A45 canonical migration rehearsal: PASS (ROLLED BACK)");
    console.log("Hosted Neon persistent changes: NONE");
    process.exit(0);
  }
  restoreSql(databaseUrl, migration);
}

if (rehearseOnly) {
  console.log("A45 canonical migration rehearsal: ALREADY INSTALLED");
  process.exit(0);
}

assert.deepEqual(JSON.parse(runSql(databaseUrl, evidenceSql)), before, "A45 schema installation changed protected rows.");
assert.equal(runSql(databaseUrl, "select has_function_privilege('tindio_authenticated','public.list_pos_operational_alerts(uuid)','execute');"), "t");
assert.equal(runSql(databaseUrl, "select has_function_privilege('tindio_authenticated','public.acknowledge_pos_operational_alert(uuid,uuid)','execute');"), "t");
assert.equal(runSql(databaseUrl, "select count(*) from pg_proc proc cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where proc.oid='public.list_pos_operational_alerts(uuid)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE';"), "0");
runSql(databaseUrl, "select pg_notify('pgrst', 'reload schema');");
console.log(`A45 canonical migration: ${installedValues.every(Boolean) ? "ALREADY_INSTALLED" : "REHEARSED_AND_APPLIED"}`);
console.log("Hosted Neon protected row counts unchanged: PASS");
console.log("Provider-neutral least-privilege alert contract: PASS");
