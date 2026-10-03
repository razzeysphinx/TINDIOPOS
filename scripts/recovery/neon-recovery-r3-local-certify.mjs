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

function localDb() {
  const result = run("pnpm", ["exec", "supabase", "status", "--output", "json"], true);
  parseAndValidateLocalSupabaseStatus(result.stdout ?? "");
  const status = JSON.parse(result.stdout ?? "{}");
  assert.ok(typeof status.DB_URL === "string");
  return status.DB_URL;
}

run("node", ["scripts/certification-local-target-preflight.mjs"]);
run("pnpm", ["exec", "supabase", "db", "reset", "--local"]);

const db = localDb();
const migration = await readFile("database/migrations/0002_provider_neutral_business_identity.sql", "utf8");
const adapter = await readFile("database/provider/local/01_identity.sql", "utf8");
runSql(db, migration);
runSql(db, adapter);

const evidence = JSON.parse(runSql(db, `
select jsonb_build_object(
  'businessAuthUidFunctions', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind in ('f','p')
      and pg_get_functiondef(p.oid) ~* 'auth\\.uid\\s*\\('
      and not (n.nspname = 'private' and p.proname = 'current_identity_subject'
        and pg_get_function_identity_arguments(p.oid) = '')
  ),
  'businessAuthJwtFunctions', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind in ('f','p')
      and pg_get_functiondef(p.oid) ~* 'auth\\.jwt\\s*\\('
      and not (n.nspname = 'private' and p.proname = 'current_identity_email'
        and pg_get_function_identity_arguments(p.oid) = '')
  ),
  'localSubjectAdapter', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind in ('f','p')
      and p.proname = 'current_identity_subject'
      and pg_get_function_identity_arguments(p.oid) = ''
      and pg_get_functiondef(p.oid) ~* 'auth\\.uid\\s*\\('
  ),
  'localEmailAdapter', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.prokind in ('f','p')
      and p.proname = 'current_identity_email'
      and pg_get_function_identity_arguments(p.oid) = ''
      and pg_get_functiondef(p.oid) ~* 'auth\\.jwt\\s*\\('
  ),
  'authRoleFunctionsDeferredToR4', (
    select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind in ('f','p')
      and pg_get_functiondef(p.oid) ~* 'auth\\.role\\s*\\('
  )
)::text;
`));

assert.equal(Number(evidence.businessAuthUidFunctions), 0);
assert.equal(Number(evidence.businessAuthJwtFunctions), 0);
assert.equal(Number(evidence.localSubjectAdapter), 1);
assert.equal(Number(evidence.localEmailAdapter), 1);
assert.equal(Number(evidence.authRoleFunctionsDeferredToR4), 1);
console.log(JSON.stringify(evidence, null, 2));

run("pnpm", ["exec", "supabase", "db", "lint", "--local", "--level", "error", "--fail-on", "error"]);
run("pnpm", ["exec", "supabase", "test", "db", "--local"]);
console.log("TINDIO R3 LOCAL PROVIDER-NEUTRAL SQL CERTIFICATION: PASS");
