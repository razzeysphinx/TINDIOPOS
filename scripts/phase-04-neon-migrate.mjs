import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import process from "node:process";

import {
  dumpBusinessData,
  restoreSql,
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

const args =
  new Set(
    process.argv.slice(2),
  );

const remoteCutover =
  args.has(
    "--cutover",
  );

function fail(message) {
  console.error(message);
  process.exit(1);
}

function validateNeonUrl(
  value,
) {
  if (!value) {
    fail(
      "DATABASE_URL_UNPOOLED is required.",
    );
  }

  const url =
    new URL(
      value,
    );

  if (
    !url.hostname
      .endsWith(
        ".neon.tech",
      )
  ) {
    fail(
      "Target database is not a Neon endpoint.",
    );
  }

  if (
    url.hostname
      .includes(
        "-pooler",
      )
  ) {
    fail(
      "Phase 04 migrations require the direct/unpooled Neon connection.",
    );
  }

  return value;
}

function localSourceUrl() {
  const result =
    runCommand(
      "pnpm",
      [
        "exec",
        "supabase",
        "status",
        "--output",
        "json",
      ],
      {
        cwd:
          process.cwd(),
        env:
          process.env,
        capture:
          true,
      },
    );

  if (
    result.error
    || result.status !== 0
  ) {
    fail(
      "Local Supabase source is unavailable.",
    );
  }

  const status =
    JSON.parse(
      String(
        result.stdout,
      ),
    );

  const dbUrl =
    status.DB_URL;

  if (
    typeof dbUrl !== "string"
    || !/(?:localhost|127\.0\.0\.1|\[::1\])/i
      .test(
        dbUrl,
      )
  ) {
    fail(
      "Rehearsal refuses a non-local implicit source database.",
    );
  }

  return dbUrl;
}

function remoteSourceUrl() {
  if (
    process.env
      .TINDIO_PHASE_04_ALLOW_CUTOVER
    !== "YES"
  ) {
    fail(
      "Remote cutover is blocked. Set TINDIO_PHASE_04_ALLOW_CUTOVER=YES only during an approved write-freeze window.",
    );
  }

  const value =
    process.env
      .TINDIO_SOURCE_DATABASE_URL;

  if (!value) {
    fail(
      "TINDIO_SOURCE_DATABASE_URL is required for remote cutover.",
    );
  }

  return value;
}

function evidenceSql() {
  return `
select jsonb_build_object(
  'profiles',
    (select count(*) from public.profiles),
  'organizations',
    (select count(*) from public.organizations),
  'stores',
    (select count(*) from public.stores),
  'employees',
    (select count(*) from public.employees),
  'products',
    (select count(*) from public.products),
  'inventory_levels',
    (select count(*) from public.inventory_levels),
  'inventory_movements',
    (select count(*) from public.inventory_movements),
  'sales',
    (select count(*) from public.sales),
  'payments',
    (select count(*) from public.payments),
  'receipts',
    (select count(*) from public.receipts),
  'identity_links',
    (select count(*) from private.identity_links),
  'current_profile_rpc',
    (select to_regprocedure('public.current_profile_id()') is not null),
  'checkout_rpc',
    (select to_regproc('public.checkout_advanced_sale') is not null)
)::text;
`;
}

async function main() {
  const target =
    validateNeonUrl(
      process.env
        .DATABASE_URL_UNPOOLED,
    );

  const source =
    remoteCutover
      ? remoteSourceUrl()
      : localSourceUrl();

  if (source === target) {
    fail(
      "Source and target databases must be different.",
    );
  }

  const existing =
    runSql(
      target,
      `
select
  to_regclass(
    'public.organizations'
  ) is not null;
`,
    );

  if (existing === "t") {
    fail(
      "Target Neon database is not empty. Use a fresh Neon branch/database for Phase 04 migration.",
    );
  }

  const [
    roles,
    extensions,
    baseline,
    identity,
  ] =
    await Promise.all([
      readFile(
        new URL(
          "../database/provider/neon/00_roles.sql",
          import.meta.url,
        ),
        "utf8",
      ),

      readFile(
        new URL(
          "../database/provider/neon/00_extensions.sql",
          import.meta.url,
        ),
        "utf8",
      ),

      readFile(
        new URL(
          "../database/baseline/0001_tindio_baseline.sql",
          import.meta.url,
        ),
        "utf8",
      ),

      readFile(
        new URL(
          "../database/provider/neon/01_identity.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);

  console.log(
    remoteCutover
      ? "TINDIO PHASE 04 NEON CUTOVER"
      : "TINDIO PHASE 04 NEON REHEARSAL",
  );

  console.log(
    "Installing Neon compatibility roles...",
  );

  restoreSql(
    target,
    roles,
  );

  console.log(
    "Installing TINDIO PostgreSQL extension dependencies...",
  );

  restoreSql(
    target,
    extensions,
  );

  const extensionEvidence =
    JSON.parse(
      runSql(
        target,
        `
select jsonb_build_object(
  'schema_exists',
    to_regnamespace(
      'extensions'
    ) is not null,

  'pgcrypto_installed',
    exists (
      select 1
      from pg_catalog.pg_extension extension_record
      join pg_catalog.pg_namespace namespace_record
        on namespace_record.oid =
          extension_record.extnamespace
      where extension_record.extname =
        'pgcrypto'
        and namespace_record.nspname =
          'extensions'
    ),

  'pg_trgm_installed',
    exists (
      select 1
      from pg_catalog.pg_extension extension_record
      join pg_catalog.pg_namespace namespace_record
        on namespace_record.oid =
          extension_record.extnamespace
      where extension_record.extname =
        'pg_trgm'
        and namespace_record.nspname =
          'extensions'
    ),

  'crypt',
    to_regprocedure(
      'extensions.crypt(text,text)'
    ) is not null,

  'gen_salt',
    to_regprocedure(
      'extensions.gen_salt(text,integer)'
    ) is not null,

  'digest',
    to_regprocedure(
      'extensions.digest(text,text)'
    ) is not null,

  'gin_trgm_ops',
    exists (
      select 1
      from pg_catalog.pg_opclass opclass
      join pg_catalog.pg_namespace namespace_record
        on namespace_record.oid =
          opclass.opcnamespace
      join pg_catalog.pg_am access_method
        on access_method.oid =
          opclass.opcmethod
      where namespace_record.nspname =
        'extensions'
        and opclass.opcname =
          'gin_trgm_ops'
        and access_method.amname =
          'gin'
    ),

  'gist_trgm_ops',
    exists (
      select 1
      from pg_catalog.pg_opclass opclass
      join pg_catalog.pg_namespace namespace_record
        on namespace_record.oid =
          opclass.opcnamespace
      join pg_catalog.pg_am access_method
        on access_method.oid =
          opclass.opcmethod
      where namespace_record.nspname =
        'extensions'
        and opclass.opcname =
          'gist_trgm_ops'
        and access_method.amname =
          'gist'
    )
)::text;
`,
      ),
    );

  for (
    const [
      key,
      value,
    ]
    of Object.entries(
      extensionEvidence,
    )
  ) {
    assert.equal(
      value,
      true,
      `Neon extension bootstrap check failed: ${key}`,
    );
  }

  console.log(
    "Installing canonical TINDIO baseline...",
  );

  restoreSql(
    target,
    baseline,
  );

  console.log(
    "Installing Neon identity adapter...",
  );

  restoreSql(
    target,
    identity,
  );

  const identityHelper =
    runSql(
      target,
      `
select
  to_regprocedure(
    'auth.user_id()'
  ) is not null;
`,
    );

  assert.equal(
    identityHelper,
    "t",
    "Neon Data API auth.user_id() is unavailable.",
  );

  console.log(
    "Copying TINDIO-owned public/private data...",
  );

  const data =
    dumpBusinessData(
      source,
    );

  restoreSql(
    target,
    data,
  );

  const sourceEvidence =
    JSON.parse(
      runSql(
        source,
        evidenceSql(),
      ),
    );

  const targetEvidence =
    JSON.parse(
      runSql(
        target,
        evidenceSql(),
      ),
    );

  const countKeys = [
    "profiles",
    "organizations",
    "stores",
    "employees",
    "products",
    "inventory_levels",
    "inventory_movements",
    "sales",
    "payments",
    "receipts",
    "identity_links",
  ];

  for (
    const key
    of countKeys
  ) {
    assert.equal(
      targetEvidence[key],
      sourceEvidence[key],
      `${key} row count differs between source and Neon target`,
    );
  }

  assert.equal(
    targetEvidence
      .current_profile_rpc,
    true,
  );

  assert.equal(
    targetEvidence
      .checkout_rpc,
    true,
  );

  console.log(
    JSON.stringify(
      {
        mode:
          remoteCutover
            ? "cutover"
            : "rehearsal",

        sourceEvidence,
        targetEvidence,
      },
      null,
      2,
    ),
  );

  console.log(
    remoteCutover
      ? "PHASE 04 NEON CUTOVER COPY: PASS"
      : "PHASE 04 NEON REHEARSAL: PASS",
  );
}

main().catch(
  (error) => {
    console.error(
      error instanceof Error
        ? error.message
        : error,
    );

    process.exit(1);
  },
);
