import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { runCommand } from "../lib/run-command.mjs";
import { restoreSql, runSql } from "../lib/phase-04-postgres-docker.mjs";

const target = Object.freeze({
  projectId: "divine-sound-41148108",
  projectName: "TINDIO R6 RECOVERY 2026-10-02",
  branchId: "br-snowy-heart-b5nf6q3n",
  branchName: "r6-clean-canonical-20261002",
  database: "tindio_r6_recovery",
  ownerRole: "tindio_r6_recovery_owner",
  host: "ep-wandering-voice-b5w9m9db.c-7.us-east-2.aws.neon.tech",
});
const chain = [
  "0002_provider_neutral_business_identity.sql", "0003_provider_neutral_roles_rls.sql",
  "0004_inventory_replenishment_read_models.sql", "0005_inventory_core_read_model_extension.sql",
  "0006_inventory_purchasing_read_model.sql", "0007_inventory_specialized_read_models.sql",
  "0008_r5_management_catalog_read_models.sql", "0009_r5_pos_reporting_read_models.sql",
  "0010_r5_residual_read_models.sql",
];

function neon(args) {
  const command = process.platform === "win32"
    ? [process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", ["neon", ...args].join(" ")]]
    : ["neon", args];
  const result = runCommand(command[0], command[1], { cwd: process.cwd(), env: process.env, capture: true });
  if (result.error || result.status !== 0) throw new Error(result.stderr || `neon ${args.join(" ")} failed.`);
  return String(result.stdout ?? "").trim();
}

async function safeTargetUrl() {
  assert.equal(process.env.TINDIO_R6_REMOTE_WRITE, "YES", "Set TINDIO_R6_REMOTE_WRITE=YES only for the isolated R6 target install.");
  const projects = JSON.parse(neon(["projects", "list", "-o", "json"]));
  assert.ok(projects.some((project) => project.id === target.projectId && project.name === target.projectName), "R6 project identity is not the approved isolated target.");
  const branches = JSON.parse(neon(["branches", "list", "--project-id", target.projectId, "-o", "json"]));
  assert.ok(branches.some((branch) => branch.id === target.branchId && branch.name === target.branchName && branch.project_id === target.projectId), "R6 branch identity is not the approved isolated target.");
  const databases = JSON.parse(neon(["databases", "list", "--project-id", target.projectId, "-o", "json"]));
  assert.ok(databases.some((database) => database.name === target.database), "R6 database identity is not available in the isolated project.");
  const url = neon(["connection-string", target.branchName, "--project-id", target.projectId, "--database-name", target.database, "--role-name", target.ownerRole, "--ssl", "require"]);
  const parsed = new URL(url);
  assert.equal(parsed.hostname, target.host, "Direct connection host is not the explicit R6 recovery endpoint.");
  assert.ok(!parsed.hostname.includes("-pooler"), "R6 install requires a direct Neon endpoint.");
  return url;
}

async function main() {
  const actualChain = (await readdir("database/migrations")).filter((name) => name.endsWith(".sql")).sort();
  assert.deepEqual(actualChain, chain, "Canonical forward migration chain changed unexpectedly.");
  const baseline = await readFile("database/baseline/0001_tindio_baseline.sql", "utf8");
  const manifest = JSON.parse(await readFile("database/baseline/0001_tindio_baseline.manifest.json", "utf8"));
  const sha256 = createHash("sha256").update(baseline).digest("hex");
  assert.equal(sha256, manifest.baselineSha256, "Baseline hash does not match manifest.");
  const url = await safeTargetUrl();
  const empty = runSql(url, "select to_regclass('public.organizations') is null;") === "t";
  const resume = process.argv.includes("--resume");
  if (!empty) {
    assert.equal(resume, true, "R6 target is not empty; refusing schema installation.");
    const fingerprint = JSON.parse(runSql(url, `select jsonb_build_object('publicTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),'privateTables',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p')),'indexes',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='i'),'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')),'policies',(select count(*) from pg_policies where schemaname in ('public','private')))::text;`));
    assert.equal(fingerprint.publicTables, 100); assert.equal(fingerprint.privateTables, 7);
    assert.equal(fingerprint.indexes, 409); assert.equal(fingerprint.policies, 149);
    assert.ok([455, 461].includes(fingerprint.functions), "R6 target is not a recognized baseline or 0004-0008 checkpoint; refusing resume.");
  } else {
    restoreSql(url, await readFile("database/provider/neon/00_extensions.sql", "utf8"));
    restoreSql(url, baseline);
  }
  restoreSql(url, await readFile("database/provider/neon/00_roles.sql", "utf8"));
  const pendingChain = resume ? chain.slice(7) : chain;
  if (resume) {
    const completedReadModels = Number(runSql(url, `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_inventory_workspace_bundle_v1','get_inventory_purchasing_bundle_v1','get_inventory_valuation_reference_bundle_v1','get_inventory_activity_reference_bundle_v1','get_management_workspace_bundle_v1','get_catalog_workspace_bundle_v1');`));
    assert.equal(completedReadModels, 6, "R6 resume requires the exact 0004-0008 read-model checkpoint.");
  }
  for (const migration of pendingChain) restoreSql(url, await readFile(`database/migrations/${migration}`, "utf8"));
  restoreSql(url, await readFile("database/provider/neon/01_identity.sql", "utf8"));
  neon(["data-api", "update", "--project-id", target.projectId, "--branch", target.branchId, "--database", target.database, "--db-anon-role", "anon", "-o", "json"]);

  const evidence = JSON.parse(runSql(url, `
    select jsonb_build_object(
      'publicTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
      'privateTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p')),
      'policies', (select count(*) from pg_policies where schemaname in ('public','private')),
      'rlsEnabled', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','p') and c.relrowsecurity),
      'canonicalRoles', (select count(*) from pg_roles where rolname in ('tindio_anon','tindio_authenticated','tindio_service')),
      'providerMappings', (select count(*) from (values ('anon','tindio_anon'),('authenticated','tindio_authenticated'),('service_role','tindio_service')) m(member,granted) where pg_has_role(m.member,m.granted,'member')),
      'providerPolicies', (select count(*) from pg_policies where schemaname in ('public','private') and roles::text[] && array['anon','authenticated','service_role']),
      'authUserId', to_regprocedure('auth.user_id()') is not null,
      'authJwt', to_regprocedure('auth.jwt()') is not null,
      'identitySubject', to_regprocedure('private.current_identity_subject()') is not null,
      'identityEmail', to_regprocedure('private.current_identity_email()') is not null,
      'r5Functions', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_inventory_workspace_bundle_v1','get_inventory_purchasing_bundle_v1','get_inventory_valuation_reference_bundle_v1','get_inventory_activity_reference_bundle_v1','get_management_workspace_bundle_v1','get_catalog_workspace_bundle_v1','get_pos_bootstrap_bundle_v1','get_dashboard_readiness_snapshot_v1','get_receipt_detail_bundle_v1')),
      'organizationRows', (select count(*) from public.organizations)
    )::text;
  `));
  assert.equal(evidence.publicTables, 100); assert.equal(evidence.privateTables, 7); assert.equal(evidence.policies, 149);
  assert.equal(evidence.canonicalRoles, 3); assert.equal(evidence.providerMappings, 3); assert.equal(evidence.providerPolicies, 0);
  assert.equal(evidence.authUserId, true); assert.equal(evidence.authJwt, true); assert.equal(evidence.identitySubject, true); assert.equal(evidence.identityEmail, true);
  assert.equal(evidence.r5Functions, 9); assert.equal(evidence.organizationRows, 0);
  console.log(JSON.stringify({ target: { ...target, host: "ep-wandering-voice-…neon.tech" }, baselineSha256: sha256, migrationChain: chain, evidence }, null, 2));
  console.log("TINDIO R6 ISOLATED NEON CANONICAL INSTALL: PASS");
}
main().catch((error) => { console.error(error instanceof Error ? error.stack : error); process.exit(1); });
