import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import process from "node:process";

import {
  parseAndValidateLocalSupabaseStatus,
} from "./lib/certification-safety.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

const ROOT = process.cwd();

function fail(message) {
  throw new Error(message);
}

function command(name, args, capture = false) {
  const result = runCommand(name, args, {
    cwd: ROOT,
    env: process.env,
    capture,
  });

  if (result.error || result.status !== 0) {
    if (capture && result.stdout) process.stdout.write(result.stdout);
    if (capture && result.stderr) process.stderr.write(result.stderr);

    fail(
      `${name} ${args.join(" ")} failed`,
    );
  }

  return String(result.stdout ?? "").trim();
}

function ensureLocalSupabase() {
  let status = runCommand(
    "pnpm",
    ["exec", "supabase", "status", "--output", "json"],
    {
      cwd: ROOT,
      env: process.env,
      capture: true,
    },
  );

  if (status.error || status.status !== 0) {
    command(
      "pnpm",
      ["exec", "supabase", "start"],
      true,
    );

    status = runCommand(
      "pnpm",
      ["exec", "supabase", "status", "--output", "json"],
      {
        cwd: ROOT,
        env: process.env,
        capture: true,
      },
    );
  }

  if (status.error || status.status !== 0) {
    fail("Local Supabase could not be confirmed.");
  }

  parseAndValidateLocalSupabaseStatus(
    String(status.stdout ?? ""),
  );
}

function findDatabaseContainer() {
  const names = command(
    "docker",
    ["ps", "--format", "{{.Names}}"],
    true,
  )
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .filter((name) => /^supabase_db_/i.test(name));

  const tindio =
    names.find((name) =>
      /tindio[_-]?pos/i.test(name),
    );

  if (tindio) return tindio;

  if (names.length === 1) return names[0];

  fail(
    `Expected one local Supabase DB container; found: ${names.join(", ") || "none"}`,
  );
}

function query(container, sql) {
  return command(
    "docker",
    [
      "exec",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    true,
  );
}

async function typeHash() {
  const text = await readFile(
    new URL(
      "../src/lib/supabase/database.types.ts",
      import.meta.url,
    ),
  );

  return createHash("sha256")
    .update(text)
    .digest("hex");
}

async function replay(label, container) {
  console.log(`=== ${label}: clean local migration replay ===`);

  command(
    "pnpm",
    ["exec", "supabase", "db", "reset", "--local"],
    true,
  );

  command(
    "node",
    ["scripts/generate-local-database-types.mjs"],
    true,
  );

  const migrationCount = Number(
    query(
      container,
      "select count(*) from supabase_migrations.schema_migrations;",
    ),
  );

  assert.ok(
    Number.isInteger(migrationCount) && migrationCount > 0,
    "Migration history must be populated after replay.",
  );

  return {
    migrationCount,
    typeHash: await typeHash(),
  };
}

async function main() {
  console.log("TINDIO PHASE 14 MIGRATION REHEARSAL");
  console.log("===================================");

  ensureLocalSupabase();

  const container = findDatabaseContainer();

  const originalHash = await typeHash();

  const first = await replay(
    "Replay A",
    container,
  );

  assert.equal(
    first.typeHash,
    originalHash,
    "Replay A generated database types drifted from the committed contract.",
  );

  const second = await replay(
    "Replay B",
    container,
  );

  assert.equal(
    second.typeHash,
    originalHash,
    "Replay B generated database types drifted from the committed contract.",
  );

  assert.equal(
    first.typeHash,
    second.typeHash,
    "Two clean migration replays produced different generated contracts.",
  );

  assert.equal(
    first.migrationCount,
    second.migrationCount,
    "Two clean migration replays produced different migration-history counts.",
  );

  const migrationStatus = command(
    "git",
    [
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      "supabase/migrations",
      "src/lib/supabase/database.types.ts",
    ],
    true,
  );

  assert.equal(
    migrationStatus,
    "",
    "Migration rehearsal changed tracked migrations or generated database types.",
  );

  console.log(JSON.stringify({
    migrationCount: first.migrationCount,
    replayATypeHash: first.typeHash,
    replayBTypeHash: second.typeHash,
  }, null, 2));

  console.log("PHASE 14 MIGRATION REHEARSAL: PASS");
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Phase 14 migration rehearsal failed.",
  );

  process.exit(1);
}
