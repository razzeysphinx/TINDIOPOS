import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import process from "node:process";

import {
  restoreSql,
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (
  process.env.TINDIO_PHASE_04_ALLOW_V2_HOSTED_APPLY
  !== "YES"
) {
  fail(
    "Hosted V2 apply is locked. Set TINDIO_PHASE_04_ALLOW_V2_HOSTED_APPLY=YES only for the approved Phase 04F PREPRODUCTION apply.",
  );
}

if (
  process.env.TINDIO_DATABASE_PROVIDER
  !== "neon"
) {
  fail("TINDIO_DATABASE_PROVIDER must be neon.");
}

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED;

if (!databaseUrl) {
  fail("DATABASE_URL_UNPOOLED is required.");
}

const parsed =
  new URL(databaseUrl);

if (
  !parsed.hostname.endsWith(".neon.tech")
  || parsed.hostname.includes("-pooler")
) {
  fail(
    "Hosted V2 apply requires the direct/unpooled Neon endpoint.",
  );
}

const migrations = [
  "../supabase/migrations/20260924_phase_04_pos_bootstrap_v2_core.sql",
  "../supabase/migrations/20260924071716_phase_04_pos_reference_v2.sql",
  "../supabase/migrations/20260924075521_phase_04_pos_live_v2.sql",
  "../supabase/migrations/20260924081131_phase_04_pos_catalog_v2.sql",
];

const forbiddenBusinessMutation =
  /\b(?:insert\s+into|update\s+[a-z_]|delete\s+from|truncate|drop\s+table|alter\s+table|create\s+table)\b/i;

const expectedFunctions = [
  "public.get_pos_bootstrap_core_v2(uuid)",
  "public.get_pos_reference_bundle_v2(uuid)",
  "public.get_pos_live_state_v2(uuid,uuid,uuid)",
  "public.get_pos_catalog_v2(uuid,uuid,text,text,uuid,integer,integer)",
  "public.get_pos_modifiers_v2(uuid,uuid,uuid)",
];

function evidenceSql() {
  return `
select jsonb_build_object(
  'organizations',
    (select count(*) from public.organizations),
  'stores',
    (select count(*) from public.stores),
  'employees',
    (select count(*) from public.employees),
  'products',
    (select count(*) from public.products),
  'sales',
    (select count(*) from public.sales),
  'payments',
    (select count(*) from public.payments),
  'receipts',
    (select count(*) from public.receipts)
)::text;
`;
}

const before =
  JSON.parse(
    runSql(databaseUrl, evidenceSql()),
  );

console.log("Hosted Neon connectivity: PASS");
console.log(
  `Hosted target host fingerprint: ${parsed.hostname.slice(0, 8)}…${parsed.hostname.slice(-10)}`,
);

for (const migration of migrations) {
  const sql =
    await readFile(
      new URL(migration, import.meta.url),
      "utf8",
    );

  if (forbiddenBusinessMutation.test(sql)) {
    fail(
      `Unsafe hosted V2 migration content detected in ${migration}.`,
    );
  }

  console.log(
    `Applying ${migration.split("/").at(-1)}...`,
  );

  restoreSql(databaseUrl, sql);
}

for (const signature of expectedFunctions) {
  const exists =
    runSql(
      databaseUrl,
      `
select
  to_regprocedure(
    '${signature}'
  ) is not null;
`,
    );

  assert.equal(
    exists,
    "t",
    `Hosted Neon function missing: ${signature}`,
  );
}

const after =
  JSON.parse(
    runSql(databaseUrl, evidenceSql()),
  );

assert.deepEqual(
  after,
  before,
  "Business-row evidence changed while applying read-only V2 functions.",
);

console.log(
  JSON.stringify(
    {
      businessRowsUnchanged: true,
      functions: expectedFunctions,
    },
    null,
    2,
  ),
);
console.log("PHASE 04F HOSTED V2 APPLY: PASS");
