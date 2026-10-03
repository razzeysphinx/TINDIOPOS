import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  parseAndValidateLocalSupabaseStatus,
} from "../lib/certification-safety.mjs";

import { runCommand } from "../lib/run-command.mjs";
import { runSql } from "../lib/phase-04-postgres-docker.mjs";

function run(command, args, capture = false) {
  console.log(`$ ${command} ${args.join(" ")}`);

  const result = runCommand(command, args, {
    cwd: process.cwd(),
    env: process.env,
    capture,
  });

  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result;
}

function localDatabaseUrl() {
  const result = run(
    "pnpm",
    ["exec", "supabase", "status", "--output", "json"],
    true,
  );

  parseAndValidateLocalSupabaseStatus(result.stdout ?? "");

  const status = JSON.parse(result.stdout ?? "{}");
  assert.ok(typeof status.DB_URL === "string");
  return status.DB_URL;
}

run("node", ["scripts/certification-local-target-preflight.mjs"]);
run("pnpm", ["exec", "supabase", "db", "reset", "--local"]);

const db = localDatabaseUrl();

const r3Migration = await readFile(
  "database/migrations/0002_provider_neutral_business_identity.sql",
  "utf8",
);

const r4Migration = await readFile(
  "database/migrations/0003_provider_neutral_roles_rls.sql",
  "utf8",
);

const localIdentity = await readFile(
  "database/provider/local/01_identity.sql",
  "utf8",
);

const localRoles = await readFile(
  "database/provider/local/00_roles.sql",
  "utf8",
);

runSql(db, r3Migration);
runSql(db, localIdentity);
runSql(db, r4Migration);
runSql(db, localRoles);

const evidence = JSON.parse(
  runSql(
    db,
    `
with direct_acl as (
  select role.rolname as grantee
  from pg_catalog.pg_class object
  join pg_catalog.pg_namespace namespace
    on namespace.oid = object.relnamespace
  cross join lateral pg_catalog.aclexplode(object.relacl) acl
  left join pg_catalog.pg_roles role
    on role.oid = acl.grantee
  where namespace.nspname in ('public', 'private')
    and object.relacl is not null

  union all

  select role.rolname as grantee
  from pg_catalog.pg_proc object
  join pg_catalog.pg_namespace namespace
    on namespace.oid = object.pronamespace
  cross join lateral pg_catalog.aclexplode(object.proacl) acl
  left join pg_catalog.pg_roles role
    on role.oid = acl.grantee
  where namespace.nspname in ('public', 'private')
    and object.proacl is not null

  union all

  select role.rolname as grantee
  from pg_catalog.pg_namespace object
  cross join lateral pg_catalog.aclexplode(object.nspacl) acl
  left join pg_catalog.pg_roles role
    on role.oid = acl.grantee
  where object.nspname in ('public', 'private')
    and object.nspacl is not null
)
select jsonb_build_object(
  'providerPolicies',
    (
      select count(*)
      from pg_catalog.pg_policies policy
      where policy.schemaname in ('public', 'private')
        and policy.roles::text[]
          && array['authenticated', 'anon', 'service_role']
    ),

  'canonicalAuthenticatedPolicies',
    (
      select count(*)
      from pg_catalog.pg_policies policy
      where policy.schemaname in ('public', 'private')
        and 'tindio_authenticated' = any(policy.roles::text[])
    ),

  'providerAuthPolicies',
    (
      select count(*)
      from pg_catalog.pg_policies policy
      where policy.schemaname in ('public', 'private')
        and (
          coalesce(policy.qual, '') || ' ' ||
          coalesce(policy.with_check, '')
        ) ~* 'auth\\.(uid|user_id|jwt|role)\\s*\\('
    ),

  'authRoleFunctions',
    (
      select count(*)
      from pg_catalog.pg_proc function
      join pg_catalog.pg_namespace namespace
        on namespace.oid = function.pronamespace
      where namespace.nspname in ('public', 'private')
        and function.prokind in ('f', 'p')
        and pg_get_functiondef(function.oid) ~* 'auth\\.role\\s*\\('
    ),

  'directProviderAclEntries',
    (
      select count(*)
      from direct_acl
      where grantee in ('authenticated', 'anon', 'service_role')
    ),

  'directCanonicalAclEntries',
    (
      select count(*)
      from direct_acl
      where grantee in ('tindio_authenticated', 'tindio_anon', 'tindio_service')
    ),

  'authenticatedRoleMapping',
    pg_catalog.pg_has_role(
      'authenticated',
      'tindio_authenticated',
      'member'
    ),

  'anonRoleMapping',
    pg_catalog.pg_has_role(
      'anon',
      'tindio_anon',
      'member'
    ),

  'serviceRoleMapping',
    pg_catalog.pg_has_role(
      'service_role',
      'tindio_service',
      'member'
    ),

  'authenticatedInherit',
    (select rolinherit from pg_catalog.pg_roles where rolname = 'authenticated'),

  'anonInherit',
    (select rolinherit from pg_catalog.pg_roles where rolname = 'anon'),

  'serviceRoleInherit',
    (select rolinherit from pg_catalog.pg_roles where rolname = 'service_role'),

  'serviceWorkerForServiceRole',
    pg_catalog.has_function_privilege(
      'service_role',
      'public.update_receipt_delivery_status(uuid,text,text,text)',
      'EXECUTE'
    ),

  'serviceWorkerForAuthenticated',
    pg_catalog.has_function_privilege(
      'authenticated',
      'public.update_receipt_delivery_status(uuid,text,text,text)',
      'EXECUTE'
    )
)::text;
`,
  ),
);

assert.equal(Number(evidence.providerPolicies), 0);
assert.equal(Number(evidence.canonicalAuthenticatedPolicies), 141);
assert.equal(Number(evidence.providerAuthPolicies), 0);
assert.equal(Number(evidence.authRoleFunctions), 0);
assert.equal(Number(evidence.directProviderAclEntries), 0);
assert.ok(Number(evidence.directCanonicalAclEntries) > 0);

assert.equal(evidence.authenticatedRoleMapping, true);
assert.equal(evidence.anonRoleMapping, true);
assert.equal(evidence.serviceRoleMapping, true);
assert.equal(evidence.authenticatedInherit, true);
assert.equal(evidence.anonInherit, true);
assert.equal(evidence.serviceRoleInherit, true);
assert.equal(evidence.serviceWorkerForServiceRole, true);
assert.equal(evidence.serviceWorkerForAuthenticated, false);

console.log("R4 local security evidence:");
console.log(JSON.stringify(evidence, null, 2));

run("pnpm", [
  "exec",
  "supabase",
  "db",
  "lint",
  "--local",
  "--level",
  "error",
  "--fail-on",
  "error",
]);

run("pnpm", [
  "exec",
  "supabase",
  "test",
  "db",
  "--local",
]);

console.log(
  "TINDIO R4 LOCAL ROLE / RLS / SECURITY CERTIFICATION: PASS",
);
