import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";

const root = process.cwd();
const container = `tindio-r6-local-${process.pid}`;
const password = randomBytes(24).toString("hex");
const expectedChain = [
  "0002_provider_neutral_business_identity.sql",
  "0003_provider_neutral_roles_rls.sql",
  "0004_inventory_replenishment_read_models.sql",
  "0005_inventory_core_read_model_extension.sql",
  "0006_inventory_purchasing_read_model.sql",
  "0007_inventory_specialized_read_models.sql",
  "0008_r5_management_catalog_read_models.sql",
  "0009_r5_pos_reporting_read_models.sql",
  "0010_r5_residual_read_models.sql",
];

function docker(args, input = undefined, capture = false) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    input,
    stdio: capture ? ["pipe", "pipe", "pipe"] : ["pipe", "inherit", "inherit"],
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || `docker ${args.join(" ")} failed.`);
  }
  return result.stdout ?? "";
}

function sql(source, capture = false) {
  return docker(
    ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t"],
    source,
    capture,
  ).trim();
}

async function read(path) {
  return readFile(path, "utf8");
}

async function main() {
  const migrations = (await readdir("database/migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  assert.deepEqual(migrations, expectedChain, "Canonical forward migration chain is incomplete or out of order.");

  const baseline = await read("database/baseline/0001_tindio_baseline.sql");
  const manifest = JSON.parse(await read("database/baseline/0001_tindio_baseline.manifest.json"));
  const baselineSha256 = createHash("sha256").update(baseline).digest("hex");
  assert.equal(baselineSha256, manifest.baselineSha256, "Canonical baseline hash differs from the manifest.");

  docker([
    "run", "--rm", "-d", "--name", container,
    "-e", `POSTGRES_PASSWORD=${password}`,
    "postgres:17-alpine",
  ], undefined, true);

  try {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const result = spawnSync("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "postgres"], { encoding: "utf8" });
      if (result.status === 0) {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
    assert.equal(ready, true, "Disposable PostgreSQL did not become ready.");

    sql(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid; $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb; $$;
    `);

    // The canonical dump contains objects that depend on the portable
    // extensions schema. This is an installation prerequisite, not a
    // historical migration replay or an identity/security adapter.
    sql(await read("database/provider/neon/00_extensions.sql"));
    sql(baseline);
    sql(await read("database/provider/neon/00_roles.sql"));
    for (const migration of expectedChain) sql(await read(`database/migrations/${migration}`));
    sql(await read("database/provider/local/01_identity.sql"));

    const evidence = JSON.parse(sql(`
      select jsonb_build_object(
        'schemas', (select count(*) from pg_catalog.pg_namespace where nspname in ('public', 'private', 'auth', 'extensions')),
        'publicTables', (select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'public' and relation.relkind in ('r','p')),
        'privateTables', (select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname = 'private' and relation.relkind in ('r','p')),
        'policies', (select count(*) from pg_catalog.pg_policies where schemaname in ('public', 'private')),
        'rlsEnabled', (select count(*) from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace where namespace.nspname in ('public', 'private') and relation.relkind in ('r','p') and relation.relrowsecurity),
        'canonicalRoles', (select count(*) from pg_catalog.pg_roles where rolname in ('tindio_anon','tindio_authenticated','tindio_service')),
        'providerMappings', (select count(*) from (values ('anon','tindio_anon'), ('authenticated','tindio_authenticated'), ('service_role','tindio_service')) mapping(member, granted) where pg_catalog.pg_has_role(mapping.member, mapping.granted, 'member')),
        'providerPolicies', (select count(*) from pg_catalog.pg_policies where schemaname in ('public', 'private') and roles::text[] && array['anon','authenticated','service_role']),
        'providerAuthPolicyCalls', (select count(*) from pg_catalog.pg_policies where schemaname in ('public', 'private') and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~* 'auth\\.(uid|user_id|jwt|role)\\s*\\('),
        'identitySubject', to_regprocedure('private.current_identity_subject()') is not null,
        'identityEmail', to_regprocedure('private.current_identity_email()') is not null,
        'r5Functions', (select count(*) from pg_catalog.pg_proc function join pg_catalog.pg_namespace namespace on namespace.oid = function.pronamespace where namespace.nspname = 'public' and function.proname in ('get_inventory_workspace_bundle_v1','get_inventory_purchasing_bundle_v1','get_inventory_valuation_reference_bundle_v1','get_inventory_activity_reference_bundle_v1','get_management_workspace_bundle_v1','get_catalog_workspace_bundle_v1','get_pos_bootstrap_bundle_v1','get_dashboard_readiness_snapshot_v1','get_receipt_detail_bundle_v1'))
      )::text;
    `, true));

    assert.equal(evidence.publicTables, manifest.sourceSchemaCounts.publicTables);
    assert.equal(evidence.privateTables, manifest.sourceSchemaCounts.privateTables);
    assert.equal(evidence.policies, 149);
    assert.equal(evidence.canonicalRoles, 3);
    assert.equal(evidence.providerMappings, 3);
    assert.equal(evidence.providerPolicies, 0);
    assert.equal(evidence.providerAuthPolicyCalls, 0);
    assert.equal(evidence.identitySubject, true);
    assert.equal(evidence.identityEmail, true);
    assert.equal(evidence.r5Functions, 9);

    console.log(JSON.stringify({ baselineSha256, migrationChain: expectedChain, evidence }, null, 2));
    console.log("TINDIO R6 LOCAL CLEAN CANONICAL REBUILD: PASS");
  } finally {
    spawnSync("docker", ["rm", "-f", container], { encoding: "utf8", stdio: "ignore" });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
