import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const AUDITED_ANCESTOR = "2d48e2ead33d783aef6c61dedb661ba74714ea9a";
const EXPECTED_BRANCH = "recovery/neon-canonical-rebuild";
const AUDITED_HISTORICAL_MIGRATION_COUNT = 211;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalMigrationText(value) {
  return value.replace(/\r\n/g, "\n");
}

function historicalMigrationPaths() {
  const output = git([
    "ls-tree",
    "-r",
    "--name-only",
    AUDITED_ANCESTOR,
    "--",
    "archive/database/supabase-migrations",
  ]);
  const files = output
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  assert.equal(
    files.length,
    AUDITED_HISTORICAL_MIGRATION_COUNT,
    "Audited historical migration ancestry changed unexpectedly.",
  );
  return files;
}

function assertHistoricalMigrationsImmutable() {
  const files = historicalMigrationPaths();
  for (const file of files) {
    const historicalBytes = execFileSync(
      "git",
      ["show", `${AUDITED_ANCESTOR}:${file}`],
      { cwd: ROOT, encoding: "utf8" },
    );
    const currentBytes = readFileSync(path.join(ROOT, file), "utf8");
    assert.equal(
      sha256(canonicalMigrationText(currentBytes)),
      sha256(canonicalMigrationText(historicalBytes)),
      `Historical migration was modified: ${file}`,
    );
  }
  return files;
}

const branch = git(["branch", "--show-current"]);
assert.equal(branch, EXPECTED_BRANCH, `Recovery work must run on ${EXPECTED_BRANCH}.`);
execFileSync("git", ["merge-base", "--is-ancestor", AUDITED_ANCESTOR, "HEAD"], { cwd: ROOT, stdio: "ignore" });
assert.equal(git(["ls-files", "-u"]), "", "Recovery cannot run with unresolved Git conflicts.");

const staged = git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean);
const stagedEnv = staged.filter((file) => /(^|\/)\.env(?:\.|$)/.test(file));
assert.deepEqual(stagedEnv, [], "Environment files must never be staged.");
assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "TINDIO_DATABASE_PROVIDER must be neon during Neon recovery.");

const databaseUrl = process.env.DATABASE_URL_UNPOOLED;
assert.ok(databaseUrl, "DATABASE_URL_UNPOOLED is required for read-only live Neon evidence.");
const parsed = new URL(databaseUrl);
assert.ok(parsed.hostname.toLowerCase().endsWith(".neon.tech"), "DATABASE_URL_UNPOOLED must target Neon.");
assert.ok(!parsed.hostname.toLowerCase().includes("-pooler"), "DATABASE_URL_UNPOOLED must use the direct/unpooled migration endpoint.");

const migrationFiles = readdirSync(path.join(ROOT, "supabase", "migrations")).filter((name) => name.endsWith(".sql")).sort();
const historicalFiles = assertHistoricalMigrationsImmutable();
const historicalSet = new Set(historicalFiles);
const recoveryFiles = migrationFiles
  .map((name) => `archive/database/supabase-migrations/${name}`)
  .filter((file) => !historicalSet.has(file));

assert.ok(
  migrationFiles.length >= AUDITED_HISTORICAL_MIGRATION_COUNT,
  "Current migration history cannot contain fewer files than the audited historical chain.",
);

console.log("TINDIO NEON RECOVERY PREFLIGHT: PASS");
console.log(JSON.stringify({ branch, head: git(["rev-parse", "HEAD"]), auditedAncestor: AUDITED_ANCESTOR, historicalMigrationCount: historicalFiles.length, historicalMigrationsModified: 0, recoveryForwardMigrationCount: recoveryFiles.length, migrationCount: migrationFiles.length, databaseProvider: "neon", liveTarget: "DIRECT_NEON", stagedEnvFiles: 0 }, null, 2));
