import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const final = process.argv.includes("--final");
const root = process.cwd();

function read(relativePath) {
  return readFileSync(`${root}/${relativePath}`, "utf8");
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gitBytes(...args) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 32 * 1024 * 1024 });
}

function mustExist(relativePath) {
  assert.ok(existsSync(`${root}/${relativePath}`), `Required R9 artifact is missing: ${relativePath}`);
}

function mustNotExist(relativePath) {
  assert.ok(!existsSync(`${root}/${relativePath}`), `Obsolete active path remains: ${relativePath}`);
}

const packageJson = JSON.parse(read("package.json"));
const sourceOfTruth = read("docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md");
const readme = read("README.md");
const installer = read("scripts/database/install-neon.mjs");
const certifier = read("scripts/certify-repository.mjs");

mustExist("database/baseline/0001_tindio_baseline.sql");
mustExist("archive/database/supabase-migrations.manifest.json");
mustExist("docs/recovery/evidence/r8/r8-final-certification.md");
mustExist("docs/recovery/evidence/r9/r9-repository-cleanup-audit.md");
mustExist("docs/recovery/evidence/r9/r9-cleanup-classification.json");
mustExist("docs/recovery/evidence/r9/r9-branch-audit.json");
mustExist("docs/recovery/evidence/r9/r9-isolated-neon-fresh-install.json");
mustExist("docs/recovery/evidence/r9/r9-isolated-neon-fresh-install.md");
mustExist("docs/recovery/evidence/r9/r9-final-certification.md");
mustNotExist("supabase/migrations");
mustNotExist("scripts/phase-04-neon-migrate.mjs");
mustNotExist("scripts/recovery/apply-r5-canonical-chain-local.mjs");
mustNotExist("scripts/recovery/neon-recovery-r6-install.mjs");
mustNotExist("scripts/recovery/neon-recovery-r6-local-certify.mjs");
mustNotExist("scripts/database/historical-migration-archive.mjs");

for (const name of ["db:install:local", "db:install:neon", "test:db:canonical-install", "test:recovery:neon-r9", "certify:production:api", "certify:production:browser", "test:production:failure-contract", "test:production:observability"]) {
  assert.ok(packageJson.scripts[name], `Missing stable R9 command: ${name}`);
}
for (const name of Object.keys(packageJson.scripts)) {
  assert.ok(!name.startsWith("recovery:neon"), `Obsolete recovery package command remains: ${name}`);
  assert.ok(!["migrate:phase-04:neon-cutover", "migrate:phase-04:v2-hosted", "certify:phase-04:neon-rehearsal"].includes(name), `Obsolete package command remains: ${name}`);
}

assert.match(readme, /install the canonical schema|canonical schema tooling/i, "README must document canonical installation.");
assert.match(readme, /Neon PostgreSQL/i, "README must identify Neon PostgreSQL as the database authority.");
assert.match(installer, /DATABASE_URL_UNPOOLED/, "Neon installer must require a direct Neon URL.");
assert.match(installer, /neon\.tech/, "Neon installer must guard its host.");
assert.doesNotMatch(installer, /r6-|r6_/i, "Neon installer must not hard-code an R6 target.");
assert.doesNotMatch(certifier, /supabase db reset --local/, "Repository certification must use the canonical local installer.");

const archiveManifest = JSON.parse(read("archive/database/supabase-migrations.manifest.json"));
const isolatedNeon = JSON.parse(read("docs/recovery/evidence/r9/r9-isolated-neon-fresh-install.json"));
assert.equal(isolatedNeon.status, "PASS", "Isolated Neon fresh-install evidence must pass.");
assert.equal(isolatedNeon.projectId, "morning-silence-91604301", "Unexpected R9 certification project.");
assert.equal(isolatedNeon.branchId, "br-summer-mountain-b59fxsgq", "Unexpected R9 certification branch.");
assert.equal(isolatedNeon.database, "tindio_r9_certification", "Unexpected R9 certification database.");
assert.equal(isolatedNeon.productionTouched, false, "R9 must not touch production.");
assert.equal(isolatedNeon.oldSourceTouched, false, "R9 must not touch the retained source.");
assert.equal(isolatedNeon.authRuntimeSurvivedInstall, true, "Provider auth runtime must survive installation.");
assert.equal(archiveManifest.migrationCount, archiveManifest.migrations.length, "Historical archive count mismatch.");
for (const migration of archiveManifest.migrations) {
  // Hash the committed blob so Windows checkout line-ending conversion cannot
  // produce a different result from Linux CI.
  const bytes = gitBytes("show", `HEAD:${migration.archivePath}`);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  assert.equal(sha256, migration.sha256, `Historical migration changed: ${migration.archivePath}`);
}

assert.equal(git("branch", "--show-current"), "recovery/neon-canonical-rebuild", "R9 must run on the recovery branch.");
assert.equal(git("ls-files", "-u"), "", "Unresolved merge conflicts are not allowed.");
assert.equal(git("ls-files", "docs/recovery/TINDIO_NEON_RECOVERY_R4_HANDOVER.md"), "", "The preserved R4 handover must remain untracked.");

if (final) {
  assert.match(sourceOfTruth, /R8\s+COMPLETE/, "R8 must remain complete.");
  assert.match(sourceOfTruth, /R9\s+COMPLETE/, "R9 must be marked complete only at local closure.");
  assert.match(sourceOfTruth, /CLOSED LOCALLY \/ AWAITING REPOSITORY CLOSURE/, "Source of Truth must record local-only closure.");
} else {
  assert.match(sourceOfTruth, /R9\s+(?:IMPLEMENTING|COMPLETE)/, "R9 must be actively tracked in the Source of Truth.");
}

console.log(`R9 closure contract: PASS (${archiveManifest.migrationCount} immutable historical migrations verified${final ? ", final state" : ""}).`);
