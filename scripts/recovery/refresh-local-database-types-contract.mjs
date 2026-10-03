import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { parseAndValidateLocalSupabaseStatus } from "../lib/certification-safety.mjs";
import { runCommand } from "../lib/run-command.mjs";

const ROOT = process.cwd();
const TYPE_FILE = path.join(ROOT, "src", "lib", "supabase", "database.types.ts");

function fail(message) {
  throw new Error(message);
}

function run({ command, args = [], capture = true }) {
  const result = runCommand(command, args, {
    cwd: ROOT,
    env: process.env,
    capture,
  });

  if (result.error || result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    fail(`Command failed: ${command} ${args.join(" ")}`);
  }

  return result;
}

function assertLocalDatabaseTarget() {
  const status = run({
    command: "pnpm",
    args: ["exec", "supabase", "status", "--output", "json"],
  });
  const parsed = parseAndValidateLocalSupabaseStatus(status.stdout ?? "");
  assert.ok(parsed, "Local Supabase safety validation failed.");
  console.log("Local Supabase target: CONFIRMED");
}

function assertNoMigrationWorkingTreeChanges() {
  const result = run({
    command: "git",
    args: ["status", "--porcelain", "--untracked-files=all", "--", "archive/database/supabase-migrations"],
  });
  assert.equal(
    (result.stdout ?? "").trim(),
    "",
    "Migration directory must be committed and clean before refreshing the checked-in generated type contract.",
  );
}

async function readTypeContract() {
  return readFile(TYPE_FILE, "utf8");
}

function validateGeneratedContract(content) {
  const requiredSnippets = [
    "export type Database",
    "export type TableRow",
    "current_profile_id",
    "organizations:",
    "stores:",
    "employees:",
    "products:",
    "inventory_levels:",
    "inventory_movements:",
    "sales:",
    "payments:",
    "receipts:",
    "get_pos_device_sync_checkpoint",
  ];

  for (const snippet of requiredSnippets) {
    assert.ok(content.includes(snippet), `Generated database type contract is missing required marker: ${snippet}`);
  }

  const forbiddenSnippets = [
    "DATABASE_URL_UNPOOLED",
    "NEON_DATA_API_URL=",
    "SUPABASE_SERVICE_ROLE_KEY",
    "service_role=",
    "postgresql://",
    "postgres://",
  ];

  for (const snippet of forbiddenSnippets) {
    assert.ok(!content.includes(snippet), `Generated type contract unexpectedly contains secret/config material: ${snippet}`);
  }
}

assertLocalDatabaseTarget();
assertNoMigrationWorkingTreeChanges();

const before = await readTypeContract();
run({
  command: "node",
  args: ["scripts/generate-local-database-types.mjs"],
  capture: false,
});
const after = await readTypeContract();
validateGeneratedContract(after);

if (before === after) {
  console.log("Generated database type contract is already current.");
  process.exit(0);
}

const diff = run({
  command: "git",
  args: ["diff", "--", "src/lib/supabase/database.types.ts"],
});
assert.ok((diff.stdout ?? "").trim().length > 0, "Expected a generated type diff but Git reported none.");

console.log("");
console.log("Generated database type contract changed.");
console.log("The current checked-in contract was stale relative to the canonical local schema.");
console.log("");
console.log("Review summary:");

const stat = run({
  command: "git",
  args: ["diff", "--stat", "--", "src/lib/supabase/database.types.ts"],
});
process.stdout.write(stat.stdout ?? "");

console.log("");
console.log("TINDIO LOCAL DATABASE TYPE CONTRACT REFRESH: PASS");
console.log("The generated file is intentionally left modified so it can be reviewed, staged, committed, and then verified as stable by certify:db.");
