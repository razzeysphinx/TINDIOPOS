import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import process from "node:process";

import {
  restoreSql,
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

const MIGRATION_PATH = new URL(
  "../supabase/migrations/20260924155408_phase_05_provider_neutral_organization_governance.sql",
  import.meta.url,
);

const EXPECTED_FUNCTIONS = [
  "private.has_organization_export_access(uuid)",
  "private.has_organization_lifecycle_access(uuid)",
  "private.has_organization_recovery_view_access(uuid)",
  "private.has_organization_recovery_manage_access(uuid)",
  "private.current_organization_member_employee_id(uuid)",
  "private.consume_organization_rate_limit(uuid,text)",
  "private.prepare_organization_export(uuid)",
  "public.get_organization_export_page(uuid,text,uuid)",
  "private.complete_organization_export(uuid,integer,jsonb)",
  "private.manage_organization_lifecycle(uuid,text,text)",
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function businessRowEvidence() {
  return `
select jsonb_build_object(
  'organizations', (select count(*) from public.organizations),
  'employees', (select count(*) from public.employees),
  'stores', (select count(*) from public.stores),
  'sales', (select count(*) from public.sales),
  'payments', (select count(*) from public.payments),
  'receipts', (select count(*) from public.receipts),
  'inventory_movements', (select count(*) from public.inventory_movements)
)::text;
`;
}

if (process.env.TINDIO_PHASE_05_ALLOW_GOVERNANCE_HOSTED_APPLY !== "YES") {
  fail(
    "Hosted Phase 05 governance apply is locked. Set TINDIO_PHASE_05_ALLOW_GOVERNANCE_HOSTED_APPLY=YES only after the approved PR CI and Preview gates pass.",
  );
}

if (process.env.TINDIO_DATABASE_PROVIDER !== "neon") {
  fail("TINDIO_DATABASE_PROVIDER must be neon.");
}

const databaseUrl = process.env.DATABASE_URL_UNPOOLED;

if (!databaseUrl) {
  fail("DATABASE_URL_UNPOOLED is required.");
}

const parsed = new URL(databaseUrl);
const hostname = parsed.hostname.toLowerCase();

if (!hostname.endsWith(".neon.tech") || hostname.includes("-pooler")) {
  fail("Hosted governance apply requires the direct/unpooled Neon endpoint.");
}

const migration = await readFile(MIGRATION_PATH, "utf8");

if (!/create\s+or\s+replace\s+function/i.test(migration)) {
  fail("Phase 05 governance migration does not contain function replacements.");
}

const before = JSON.parse(runSql(databaseUrl, businessRowEvidence()));

console.log("Hosted Neon connectivity: PASS");
console.log(
  `Hosted target host fingerprint: ${hostname.slice(0, 8)}…${hostname.slice(-10)}`,
);
console.log("Applying forward-only Phase 05 governance function migration...");

restoreSql(databaseUrl, migration);

for (const signature of EXPECTED_FUNCTIONS) {
  const definition = runSql(
    databaseUrl,
    `select pg_get_functiondef('${signature}'::regprocedure);`,
  );

  assert.doesNotMatch(
    definition,
    /\bauth\.uid\s*\(\s*\)/i,
    `Hosted provider coupling remains in ${signature}.`,
  );
  assert.match(
    definition,
    /\bprivate\.(?:current_profile_id|current_organization_member_employee_id)\s*\(/i,
    `Hosted provider-neutral identity boundary is missing from ${signature}.`,
  );
}

const after = JSON.parse(runSql(databaseUrl, businessRowEvidence()));

assert.deepEqual(
  after,
  before,
  "Business-row evidence changed while applying function definitions only.",
);

console.log(JSON.stringify({
  businessRowsUnchanged: true,
  functions: EXPECTED_FUNCTIONS,
}, null, 2));
console.log("PHASE 05 HOSTED GOVERNANCE APPLY: PASS");
