import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

import { parseAndValidateLocalSupabaseStatus } from "../lib/certification-safety.mjs";
import { runCommand } from "../lib/run-command.mjs";
import { runSql } from "../lib/phase-04-postgres-docker.mjs";

function run(command, args, capture = false) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = runCommand(command, args, { cwd: process.cwd(), env: process.env, capture });
  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
  return result;
}

function getLocalDatabaseUrl() {
  const result = run("pnpm", ["exec", "supabase", "status", "--output", "json"], true);
  parseAndValidateLocalSupabaseStatus(result.stdout ?? "");
  const status = JSON.parse(result.stdout ?? "{}");
  assert.ok(typeof status.DB_URL === "string");
  return status.DB_URL;
}

run("node", ["scripts/certification-local-target-preflight.mjs"]);
run("pnpm", ["exec", "supabase", "db", "reset", "--local"]);
const db = getLocalDatabaseUrl();

for (const path of [
  "database/migrations/0002_provider_neutral_business_identity.sql",
  "database/provider/local/01_identity.sql",
  "database/migrations/0003_provider_neutral_roles_rls.sql",
  "database/provider/local/00_roles.sql",
  "database/migrations/0004_inventory_replenishment_read_models.sql",
]) runSql(db, await readFile(path, "utf8"));

const metadata = JSON.parse(runSql(db, `
select jsonb_build_object(
  'function_count', count(*),
  'security_definer_count', count(*) filter (where function.prosecdef),
  'stable_count', count(*) filter (where function.provolatile = 's'),
  'canonical_execute', bool_or(pg_catalog.has_function_privilege('tindio_authenticated', function.oid, 'EXECUTE')),
  'authenticated_execute', bool_or(pg_catalog.has_function_privilege('authenticated', function.oid, 'EXECUTE')),
  'anon_execute', bool_or(pg_catalog.has_function_privilege('anon', function.oid, 'EXECUTE')),
  'auth_helper_references', count(*) filter (where pg_catalog.pg_get_functiondef(function.oid) ~* 'auth\\.(uid|jwt|role|user_id)\\s*\\(')
)::text
from pg_catalog.pg_proc function
join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace
where namespace.nspname = 'public' and function.proname = 'get_inventory_workspace_bundle_v1';`));

assert.equal(Number(metadata.function_count), 1);
assert.equal(Number(metadata.security_definer_count), 0);
assert.equal(Number(metadata.stable_count), 1);
assert.equal(metadata.canonical_execute, true);
assert.equal(metadata.authenticated_execute, true);
assert.equal(metadata.anon_execute, false);
assert.equal(Number(metadata.auth_helper_references), 0);

const smoke = JSON.parse(runSql(db, `
select public.get_inventory_workspace_bundle_v1(
  target_organization_id => '00000000-0000-0000-0000-000000000000'::uuid,
  target_store_ids => null,
  requested_needs => array[]::text[]
)::text;`));
assert.ok(typeof smoke === "object" && smoke !== null);
console.log("R5-S2B LOCAL READ MODEL EVIDENCE:");
console.log(JSON.stringify(metadata, null, 2));
console.log("TINDIO R5-S2B LOCAL CERTIFICATION: PASS");
