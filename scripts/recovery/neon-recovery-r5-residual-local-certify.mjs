import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";
import { parseAndValidateLocalSupabaseStatus } from "../lib/certification-safety.mjs";
import { runCommand } from "../lib/run-command.mjs";
import { runSql } from "../lib/phase-04-postgres-docker.mjs";

function run(command, args, capture = false) { const result = runCommand(command, args, { cwd: process.cwd(), env: process.env, capture }); if (result.error || result.status !== 0) throw new Error(`Command failed: ${command} ${args.join(" ")}`); return result; }
run("node", ["scripts/certification-local-target-preflight.mjs"]);
run("pnpm", ["exec", "supabase", "db", "reset", "--local"]);
const status = run("pnpm", ["exec", "supabase", "status", "--output", "json"], true);
parseAndValidateLocalSupabaseStatus(status.stdout ?? "");
const db = JSON.parse(status.stdout ?? "{}").DB_URL;
assert.equal(typeof db, "string");
for (const path of ["database/migrations/0002_provider_neutral_business_identity.sql", "database/provider/local/01_identity.sql", "database/migrations/0003_provider_neutral_roles_rls.sql", "database/provider/local/00_roles.sql", "database/migrations/0004_inventory_replenishment_read_models.sql", "database/migrations/0005_inventory_core_read_model_extension.sql", "database/migrations/0006_inventory_purchasing_read_model.sql", "database/migrations/0007_inventory_specialized_read_models.sql", "database/migrations/0008_r5_management_catalog_read_models.sql", "database/migrations/0009_r5_pos_reporting_read_models.sql", "database/migrations/0010_r5_residual_read_models.sql"]) runSql(db, await readFile(path, "utf8"));
const metadata = JSON.parse(runSql(db, `select jsonb_build_object('functionCount',count(*),'securityDefinerCount',count(*) filter(where p.prosecdef),'stableCount',count(*) filter(where p.provolatile='s'),'canonicalExecuteCount',count(*) filter(where pg_catalog.has_function_privilege('tindio_authenticated',p.oid,'EXECUTE')),'anonExecuteCount',count(*) filter(where pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')),'authHelperReferences',count(*) filter(where pg_catalog.pg_get_functiondef(p.oid)~*'auth\\.(uid|jwt|role|user_id)\\s*\\('))::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_receipt_detail_bundle_v1','get_time_clock_workspace_bundle_v1');`));
assert.equal(Number(metadata.functionCount),2); assert.equal(Number(metadata.securityDefinerCount),0); assert.equal(Number(metadata.stableCount),2); assert.equal(Number(metadata.canonicalExecuteCount),2); assert.equal(Number(metadata.anonExecuteCount),0); assert.equal(Number(metadata.authHelperReferences),0);
assert.equal(typeof JSON.parse(runSql(db,"select public.get_receipt_detail_bundle_v1('00000000-0000-0000-0000-000000000000'::uuid,'00000000-0000-0000-0000-000000000000'::uuid,false,false)::text;")),"object");
assert.equal(typeof JSON.parse(runSql(db,"select public.get_time_clock_workspace_bundle_v1('00000000-0000-0000-0000-000000000000'::uuid,array[]::uuid[],null,null,null,null,true)::text;")),"object");
run("pnpm", ["exec", "supabase", "db", "lint", "--local", "--level", "error", "--fail-on", "error"]);
console.log("TINDIO R5 RESIDUAL LOCAL CERTIFICATION: PASS",JSON.stringify(metadata));
