import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const EXPECTED_ANCESTOR = "2d48e2ead33d783aef6c61dedb661ba74714ea9a";
const EXPECTED_BRANCH = "recovery/neon-canonical-rebuild";

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

const branch = git(["branch", "--show-current"]);
assert.equal(branch, EXPECTED_BRANCH, `Recovery work must run on ${EXPECTED_BRANCH}.`);
execFileSync("git", ["merge-base", "--is-ancestor", EXPECTED_ANCESTOR, "HEAD"], { cwd: ROOT, stdio: "ignore" });
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
assert.equal(migrationFiles.length, 211, "R1 expects the audited 211-file historical migration set. Re-audit before continuing if this changed.");

console.log("TINDIO NEON RECOVERY PREFLIGHT: PASS");
console.log(JSON.stringify({ branch, head: git(["rev-parse", "HEAD"]), auditedAncestor: EXPECTED_ANCESTOR, migrationCount: migrationFiles.length, databaseProvider: "neon", liveTarget: "DIRECT_NEON", stagedEnvFiles: 0 }, null, 2));
