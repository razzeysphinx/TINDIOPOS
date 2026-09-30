import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import {
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";

import path from "node:path";
import process from "node:process";

import {
  parseAndValidateLocalSupabaseStatus,
} from "../lib/certification-safety.mjs";

import {
  runCommand,
} from "../lib/run-command.mjs";

import {
  runSql,
} from "../lib/phase-04-postgres-docker.mjs";

const ROOT =
  process.cwd();

const BASELINE_PATH =
  path.join(
    ROOT,
    "database",
    "baseline",
    "0001_tindio_baseline.sql",
  );

const MANIFEST_PATH =
  path.join(
    ROOT,
    "database",
    "baseline",
    "0001_tindio_baseline.manifest.json",
  );

const HISTORICAL_ANCESTOR =
  "2d48e2ead33d783aef6c61dedb661ba74714ea9a";

const HISTORICAL_MIGRATION_COUNT =
  211;

function sha256(
  value,
) {
  return createHash(
    "sha256",
  )
    .update(
      value,
    )
    .digest(
      "hex",
    );
}

function run({
  command,
  args = [],
  capture = true,
}) {
  const result =
    runCommand(
      command,
      args,
      {
        cwd:
          ROOT,

        env:
          process.env,

        capture,
      },
    );

  if (
    result.error
    || result.status !== 0
  ) {
    if (
      result.stdout
    ) {
      process.stdout.write(
        result.stdout,
      );
    }

    if (
      result.stderr
    ) {
      process.stderr.write(
        result.stderr,
      );
    }

    throw new Error(
      `Command failed: ${command} ${args.join(" ")}`,
    );
  }

  return result;
}

function localDatabaseUrl() {
  const result =
    run({
      command:
        "pnpm",

      args: [
        "exec",
        "supabase",
        "status",
        "--output",
        "json",
      ],
    });

  parseAndValidateLocalSupabaseStatus(
    result.stdout ?? "",
  );

  const parsed =
    JSON.parse(
      result.stdout ?? "{}",
    );

  assert.ok(
    typeof parsed.DB_URL
      === "string",
    "Supabase status did not expose DB_URL.",
  );

  return parsed.DB_URL;
}

function jsonSql(
  databaseUrl,
  sql,
) {
  return JSON.parse(
    runSql(
      databaseUrl,
      sql,
    ),
  );
}

async function migrationEvidence() {
  const historical =
    run({
      command:
        "git",

      args: [
        "ls-tree",
        "-r",
        "--name-only",
        HISTORICAL_ANCESTOR,
        "--",
        "supabase/migrations",
      ],
    })
      .stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .filter(
        (file) =>
          file.endsWith(
            ".sql",
          ),
      )
      .sort();

  assert.equal(
    historical.length,
    HISTORICAL_MIGRATION_COUNT,
    "Audited historical migration count changed.",
  );

  const currentNames =
    (
      await readdir(
        path.join(
          ROOT,
          "supabase",
          "migrations",
        ),
      )
    )
      .filter(
        (name) =>
          name.endsWith(
            ".sql",
          ),
      )
      .sort();

  const historicalSet =
    new Set(
      historical.map(
        (file) =>
          file.replace(
            "supabase/migrations/",
            "",
          ),
      ),
    );

  const recoveryNames =
    currentNames.filter(
      (name) =>
        !historicalSet.has(
          name,
        ),
    );

  const migrationHash =
    createHash(
      "sha256",
    );

  for (
    const name
    of currentNames
  ) {
    const content =
      await readFile(
        path.join(
          ROOT,
          "supabase",
          "migrations",
          name,
        ),
      );

    migrationHash.update(
      name,
    );

    migrationHash.update(
      "\0",
    );

    migrationHash.update(
      content,
    );

    migrationHash.update(
      "\0",
    );
  }

  return {
    historicalMigrationCount:
      historical.length,

    recoveryForwardMigrationCount:
      recoveryNames.length,

    activeMigrationCount:
      currentNames.length,

    recoveryForwardMigrations:
      recoveryNames,

    migrationSetSha256:
      migrationHash.digest(
        "hex",
      ),
  };
}

const baseline =
  await readFile(
    BASELINE_PATH,
    "utf8",
  );

assert.ok(
  baseline.trim().length > 0,
  "Canonical baseline is empty.",
);

const databaseUrl =
  localDatabaseUrl();

const schemaCounts =
  jsonSql(
    databaseUrl,
    `
select jsonb_build_object(
  'publicTables',
    (
      select count(*)
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
    ),

  'privateTables',
    (
      select count(*)
      from information_schema.tables
      where table_schema = 'private'
        and table_type = 'BASE TABLE'
    ),

  'publicFunctions',
    (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n
        on n.oid = p.pronamespace
      where n.nspname = 'public'
    ),

  'privateFunctions',
    (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n
        on n.oid = p.pronamespace
      where n.nspname = 'private'
    ),

  'publicIndexes',
    (
      select count(*)
      from pg_catalog.pg_indexes
      where schemaname = 'public'
    ),

  'publicPolicies',
    (
      select count(*)
      from pg_catalog.pg_policies
      where schemaname = 'public'
    ),

  'publicTriggers',
    (
      select count(*)
      from pg_catalog.pg_trigger trg
      join pg_catalog.pg_class cls
        on cls.oid = trg.tgrelid
      join pg_catalog.pg_namespace n
        on n.oid = cls.relnamespace
      where n.nspname = 'public'
        and not trg.tgisinternal
    ),

  'privateTriggers',
    (
      select count(*)
      from pg_catalog.pg_trigger trg
      join pg_catalog.pg_class cls
        on cls.oid = trg.tgrelid
      join pg_catalog.pg_namespace n
        on n.oid = cls.relnamespace
      where n.nspname = 'private'
        and not trg.tgisinternal
    ),

  'publicSequences',
    (
      select count(*)
      from information_schema.sequences
      where sequence_schema = 'public'
    ),

  'privateSequences',
    (
      select count(*)
      from information_schema.sequences
      where sequence_schema = 'private'
    ),

  'authUidFunctions',
    (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n
        on n.oid = p.pronamespace
      where n.nspname in (
        'public',
        'private'
      )
        and p.prokind in (
          'f',
          'p'
        )
        and pg_get_functiondef(
          p.oid
        ) ~* 'auth\\.uid\\s*\\('
    ),

  'authUserIdFunctions',
    (
      select count(*)
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n
        on n.oid = p.pronamespace
      where n.nspname in (
        'public',
        'private'
      )
        and p.prokind in (
          'f',
          'p'
        )
        and pg_get_functiondef(
          p.oid
        ) ~* 'auth\\.user_id\\s*\\('
    ),

  'providerCoupledPolicies',
    (
      select count(*)
      from pg_catalog.pg_policies policy
      where policy.schemaname in (
        'public',
        'private'
      )
        and (
          (
            coalesce(
              policy.qual,
              ''
            )
            || ' '
            || coalesce(
              policy.with_check,
              ''
            )
          ) ~* 'auth\\.uid\\s*\\('
          or
          (
            coalesce(
              policy.qual,
              ''
            )
            || ' '
            || coalesce(
              policy.with_check,
              ''
            )
          ) ~* 'auth\\.user_id\\s*\\('
        )
    )
)::text;
`,
  );

const migrationEvidenceResult =
  await migrationEvidence();

const manifest = {
  formatVersion:
    1,

  source:
    "CERTIFIED_LOCAL_SUPABASE_POSTGRESQL",

  targetPurpose:
    "R2_CANONICAL_TINDIO_SCHEMA_SNAPSHOT",

  historicalAncestor:
    HISTORICAL_ANCESTOR,

  baselineSha256:
    sha256(
      baseline,
    ),

  baselineBytes:
    Buffer.byteLength(
      baseline,
      "utf8",
    ),

  baselineLines:
    baseline.split(
      "\n",
    ).length,

  migrationEvidence:
    migrationEvidenceResult,

  sourceSchemaCounts:
    schemaCounts,

  baselinePortabilityInventory: {
    authUidReferences:
      (
        baseline.match(
          /\bauth\.uid\s*\(/gi,
        )
        ?? []
      ).length,

    authUserIdReferences:
      (
        baseline.match(
          /\bauth\.user_id\s*\(/gi,
        )
        ?? []
      ).length,

    providerRoleReferences:
      (
        baseline.match(
          /\b(?:anon|authenticated|service_role)\b/gi,
        )
        ?? []
      ).length,

    postgrestReloadReferences:
      (
        baseline.match(
          /notify\s+pgrst|pgrst\.reload_schema/gi,
        )
        ?? []
      ).length,

    authSchemaReferences:
      (
        baseline.match(
          /\bauth\./gi,
        )
        ?? []
      ).length,

    storageSchemaReferences:
      (
        baseline.match(
          /\bstorage\./gi,
        )
        ?? []
      ).length,

    realtimeSchemaReferences:
      (
        baseline.match(
          /\brealtime\./gi,
        )
        ?? []
      ).length,
  },
};

await writeFile(
  MANIFEST_PATH,
  `${JSON.stringify(
    manifest,
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  "TINDIO R2 CANONICAL BASELINE MANIFEST: PASS",
);

console.log(
  JSON.stringify(
    {
      baselineSha256:
        manifest.baselineSha256,

      baselineBytes:
        manifest.baselineBytes,

      baselineLines:
        manifest.baselineLines,

      migrationEvidence:
        manifest.migrationEvidence,

      sourceSchemaCounts:
        manifest.sourceSchemaCounts,

      baselinePortabilityInventory:
        manifest.baselinePortabilityInventory,

      manifest:
        "database/baseline/0001_tindio_baseline.manifest.json",
    },
    null,
    2,
  ),
);
