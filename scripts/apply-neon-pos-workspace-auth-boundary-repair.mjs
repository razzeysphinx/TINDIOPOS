import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import process from "node:process";

import {
  requireCanonicalProductionNeonTarget,
} from "./lib/canonical-production-neon-target.mjs";

import {
  restoreSql,
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

function fail(message) {
  throw new Error(message);
}

if (
  process.env
    .TINDIO_DATABASE_PROVIDER
  !== "neon"
) {
  fail(
    "TINDIO_DATABASE_PROVIDER must be neon.",
  );
}

const { databaseUrl } =
  requireCanonicalProductionNeonTarget(
    process.env.DATABASE_URL_UNPOOLED,
  );

const migration =
  await readFile(
    new URL(
      "../archive/database/supabase-migrations/20260930020000_neon_pos_workspace_auth_boundary_repair.sql",
      import.meta.url,
    ),
    "utf8",
  );

const forbiddenMerchantMutation =
  /\b(?:insert\s+into\s+public\.(?:sales|payments|receipts|inventory_movements|products|customers)|update\s+public\.(?:sales|payments|receipts|inventory_movements|products|customers)|delete\s+from\s+public\.(?:sales|payments|receipts|inventory_movements|products|customers)|truncate)\b/i;

assert.doesNotMatch(
  migration,
  forbiddenMerchantMutation,
  "Repair migration contains forbidden merchant data mutation.",
);

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
    (select count(*) from public.receipts),
  'inventory_movements',
    (select count(*) from public.inventory_movements)
)::text;
`;
}

const before =
  JSON.parse(
    runSql(
      databaseUrl,
      evidenceSql(),
    ),
  );

console.log(
  "Applying provider-neutral POS workspace repair to hosted Neon...",
);

restoreSql(
  databaseUrl,
  migration,
);

const after =
  JSON.parse(
    runSql(
      databaseUrl,
      evidenceSql(),
    ),
  );

assert.deepEqual(
  after,
  before,
  "Business row counts changed during authorization-boundary repair.",
);

const functionDefinition =
  runSql(
    databaseUrl,
    `
select pg_get_functiondef(
  'public.search_pos_catalog(uuid,uuid,text,uuid,integer,integer)'::regprocedure
);
`,
  );

assert.match(
  functionDefinition,
  /SECURITY DEFINER/i,
  "Hosted search_pos_catalog is not SECURITY DEFINER.",
);

assert.doesNotMatch(
  functionDefinition,
  /\bauth\.uid\s*\(/i,
  "Hosted search_pos_catalog still directly calls auth.uid().",
);

assert.match(
  functionDefinition,
  /private\.require_pos_workspace_access/,
  "Hosted catalog does not enforce the canonical workspace guard.",
);

const helperDefinition =
  runSql(
    databaseUrl,
    `
select pg_get_functiondef(
  'private.require_pos_workspace_access(uuid,uuid)'::regprocedure
);
`,
  );

assert.doesNotMatch(
  helperDefinition,
  /\bauth\.uid\s*\(/i,
  "Hosted POS workspace helper still directly calls auth.uid().",
);

assert.match(
  helperDefinition,
  /private\.current_profile_id/,
  "Hosted workspace helper does not use provider-neutral profile identity.",
);

console.log(
  "Hosted Neon business row counts unchanged: PASS",
);

console.log(
  "Hosted legacy POS catalog auth boundary: PASS",
);

console.log(
  "NEON POS WORKSPACE AUTH REPAIR: PASS",
);
