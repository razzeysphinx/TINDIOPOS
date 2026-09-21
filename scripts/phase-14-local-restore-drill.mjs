import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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

function localStatus() {
  const output = command(
    "pnpm",
    ["exec", "supabase", "status", "--output", "json"],
    true,
  );

  parseAndValidateLocalSupabaseStatus(output);

  return JSON.parse(output);
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

function execInContainer(
  container,
  args,
  capture = true,
) {
  return command(
    "docker",
    [
      "exec",
      container,
      ...args,
    ],
    capture,
  );
}

function queryDatabase(
  container,
  database,
  sql,
) {
  return execInContainer(
    container,
    [
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-X",
      "-q",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
  );
}

function evidenceSql() {
  return `
select jsonb_build_object(
  'migrations',
    (select count(*) from supabase_migrations.schema_migrations),
  'inventory_levels',
    (select count(*) from public.inventory_levels),
  'inventory_movements',
    (select count(*) from public.inventory_movements),
  'stock_transfers',
    (select count(*) from public.stock_transfers),
  'goods_receipts',
    (select count(*) from public.goods_receipts),
  'production_runs',
    (select count(*) from public.production_runs),
  'replenishment_rules',
    (select count(*) from public.inventory_replenishment_rules),
  'produce_composite_rpc',
    (select to_regprocedure(
      'public.produce_composite(uuid,uuid,uuid,numeric,text,uuid)'
    ) is not null),
  'transfer_rpc',
    (select to_regprocedure(
      'public.create_stock_transfer_v2(uuid,uuid,uuid,jsonb,text,uuid)'
    ) is not null)
)::text;
`;
}

async function main() {
  console.log("TINDIO PHASE 14 ISOLATED LOCAL RESTORE DRILL");
  console.log("============================================");

  const status = localStatus();

  assert.match(
    String(status.DB_URL ?? ""),
    /(?:localhost|127\.0\.0\.1|\[::1\])/i,
    "Restore drill refuses a non-local database.",
  );

  const container = findDatabaseContainer();

  const suffix =
    randomUUID()
      .replaceAll("-", "")
      .slice(0, 12);

  const restoreDatabase =
    `tindio_phase14_restore_${suffix}`;

  const dumpPath =
    `/tmp/tindio_phase14_${suffix}.dump`;

  let createdDatabase = false;

  try {
    const sourceEvidence =
      JSON.parse(
        queryDatabase(
          container,
          "postgres",
          evidenceSql(),
        ),
      );

    execInContainer(
      container,
      [
        "pg_dump",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-Fc",
        "-f",
        dumpPath,
      ],
      false,
    );

    execInContainer(
      container,
      [
        "dropdb",
        "-U",
        "postgres",
        "--if-exists",
        "--force",
        restoreDatabase,
      ],
      false,
    );

    execInContainer(
      container,
      [
        "createdb",
        "-U",
        "postgres",
        restoreDatabase,
      ],
      false,
    );

    createdDatabase = true;

    execInContainer(
      container,
      [
        "pg_restore",
        "-U",
        "supabase_admin",
        "-d",
        restoreDatabase,
        "--no-owner",
        "--exit-on-error",
        dumpPath,
      ],
      false,
    );

    const restoredEvidence =
      JSON.parse(
        queryDatabase(
          container,
          restoreDatabase,
          evidenceSql(),
        ),
      );

    assert.deepEqual(
      restoredEvidence,
      sourceEvidence,
      "Restored database evidence differs from the local source database.",
    );

    console.log(JSON.stringify({
      sourceEvidence,
      restoredEvidence,
      restoreDatabase,
    }, null, 2));

    console.log("PHASE 14 ISOLATED LOCAL RESTORE DRILL: PASS");
  } finally {
    if (createdDatabase) {
      execInContainer(
        container,
        [
          "dropdb",
          "-U",
          "postgres",
          "--if-exists",
          "--force",
          restoreDatabase,
        ],
        false,
      );
    }

    execInContainer(
      container,
      [
        "rm",
        "-f",
        dumpPath,
      ],
      false,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Phase 14 local restore drill failed.",
  );

  process.exit(1);
}
