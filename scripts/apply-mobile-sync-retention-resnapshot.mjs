import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";
import { restoreSql, runSql } from "./lib/phase-04-postgres-docker.mjs";

assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);
const migration = await readFile(new URL("../database/migrations/0016_mobile_sync_retention_resnapshot.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /\b(?:truncate|drop\s+table|delete\s+from\s+public\.(?:sales|payments|receipts|inventory_movements)|update\s+public\.(?:sales|payments|receipts|inventory_movements)|insert\s+into\s+public\.(?:sales|payments|receipts|inventory_movements))\b/i);

const signatures = [
  "public.get_pos_sync_retention_state(uuid,uuid)",
  "public.get_pos_sync_resnapshot_v1(uuid,uuid)",
  "private.prune_pos_sync_changes(uuid,bigint)",
];
const installed = signatures.map((signature) => runSql(databaseUrl, `select to_regprocedure('${signature}') is not null;`) === "t");
assert.ok(installed.every(Boolean) || installed.every((value) => !value), "A29 migration is only partially installed; stop for manual review.");

const evidenceSql = `select jsonb_build_object(
  'organizations',(select count(*) from public.organizations),
  'stores',(select count(*) from public.stores),
  'products',(select count(*) from public.products),
  'sales',(select count(*) from public.sales),
  'payments',(select count(*) from public.payments),
  'receipts',(select count(*) from public.receipts),
  'inventory_movements',(select count(*) from public.inventory_movements),
  'pos_sync_changes',(select count(*) from public.pos_sync_changes)
)::text;`;
const before = JSON.parse(runSql(databaseUrl, evidenceSql));
if (!installed.every(Boolean)) restoreSql(databaseUrl, migration);
const after = JSON.parse(runSql(databaseUrl, evidenceSql));
assert.deepEqual(after, before, "A29 schema installation changed business or sync rows.");

for (const signature of signatures) assert.equal(runSql(databaseUrl, `select to_regprocedure('${signature}') is not null;`), "t", `Hosted Neon function missing: ${signature}`);
assert.equal(runSql(databaseUrl, "select has_function_privilege('tindio_authenticated','public.get_pos_sync_resnapshot_v1(uuid,uuid)','execute');"), "t");
assert.equal(runSql(databaseUrl, `select count(*) from pg_proc proc cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl join pg_roles role on role.oid=acl.grantee where proc.oid='public.get_pos_sync_resnapshot_v1(uuid,uuid)'::regprocedure and role.rolname='authenticated' and acl.privilege_type='EXECUTE';`), "0");
assert.equal(runSql(databaseUrl, `select count(*) from pg_proc proc cross join lateral aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) acl where proc.oid='public.get_pos_sync_resnapshot_v1(uuid,uuid)'::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE';`), "0");
assert.equal(runSql(databaseUrl, "select has_function_privilege('tindio_authenticated','private.prune_pos_sync_changes(uuid,bigint)','execute');"), "f");

console.log(`A29 canonical migration: ${installed.every(Boolean) ? "ALREADY_INSTALLED" : "APPLIED"}`);
console.log("Hosted Neon business and sync rows unchanged: PASS");
console.log("Provider-neutral direct runtime grant, no PUBLIC grant, and owner-only retention maintenance: PASS");
