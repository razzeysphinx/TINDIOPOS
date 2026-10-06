import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";
import { restoreSql, runSql } from "./lib/phase-04-postgres-docker.mjs";

if (process.env.TINDIO_DATABASE_PROVIDER !== "neon") throw new Error("TINDIO_DATABASE_PROVIDER must be neon.");
const { databaseUrl } = requireCanonicalProductionNeonTarget(process.env.DATABASE_URL_UNPOOLED);
const migration = await readFile(new URL("../archive/database/supabase-migrations/20260930030000_neon_inventory_count_runtime_boundary_repair.sql", import.meta.url), "utf8");
assert.doesNotMatch(migration, /\b(?:truncate|delete\s+from\s+public\.(?:sales|payments|receipts|inventory_movements)|update\s+public\.(?:sales|payments|receipts|inventory_movements)|insert\s+into\s+public\.(?:sales|payments|receipts|inventory_movements))\b/i);
const evidence = `select jsonb_build_object('organizations',(select count(*) from public.organizations),'stores',(select count(*) from public.stores),'employees',(select count(*) from public.employees),'products',(select count(*) from public.products),'inventory_counts',(select count(*) from public.inventory_counts),'inventory_count_lines',(select count(*) from public.inventory_count_lines),'inventory_movements',(select count(*) from public.inventory_movements),'sales',(select count(*) from public.sales),'payments',(select count(*) from public.payments),'receipts',(select count(*) from public.receipts))::text;`;
const before = JSON.parse(runSql(databaseUrl, evidence));
restoreSql(databaseUrl, migration);
const after = JSON.parse(runSql(databaseUrl, evidence));
assert.deepEqual(after, before, "Business row counts changed during inventory authorization repair.");
for (const signature of ["public.get_inventory_counts_workspace_v2(uuid,uuid[],integer)", "public.get_inventory_count_lines_workspace_v2(uuid,uuid[])", "public.get_inventory_count_batches_workspace_v2(uuid,integer)", "public.get_inventory_count_batch_documents_workspace_v2(uuid,uuid[])"]) assert.equal(runSql(databaseUrl, `select to_regprocedure('${signature}') is not null;`), "t", `Hosted Neon function missing: ${signature}`);
for (const signature of ["private.inventory_count_actor(uuid,uuid,text[])", "public.get_inventory_count_suppliers(uuid)"]) {
  const definition = runSql(databaseUrl, `select pg_get_functiondef('${signature}'::regprocedure);`);
  assert.match(definition, /private\.current_profile_id/);
  assert.doesNotMatch(definition, /\bauth\.uid\s*\(/i);
}
console.log("Hosted Neon business rows unchanged: PASS");
console.log("Inventory count provider-neutral actor: PASS");
console.log("Inventory count read RPCs: PASS");
console.log("NEON INVENTORY COUNT RUNTIME REPAIR: PASS");
