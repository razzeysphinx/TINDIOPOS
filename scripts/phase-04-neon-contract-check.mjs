import assert from "node:assert/strict";
import {
  readFile,
} from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(
    new URL(
      `../${path}`,
      import.meta.url,
    ),
    "utf8",
  );
}

const [
  neonConfig,
  databaseEnv,
  dataFetch,
  serverClient,
  migration,
  extensions,
  identityProvider,
  authActions,
  authCallback,
  phase02,
  phase03,
  packageText,
] =
  await Promise.all([
    source("neon.ts"),
    source("src/lib/database/env.ts"),
    source("src/lib/database/neon-data-api-fetch.ts"),
    source("src/lib/supabase/server.ts"),
    source("supabase/migrations/20260922180000_neon_portability_foundation.sql"),
    source(
      "database/provider/neon/00_extensions.sql",
    ),
    source("database/provider/neon/01_identity.sql"),
    source("src/features/auth/actions.ts"),
    source("src/app/auth/callback/route.ts"),
    source("scripts/phase-02-mobile-auth-contract-check.mjs"),
    source("scripts/phase-03-shared-contracts-check.mjs"),
    source("package.json"),
  ]);

const packageJson =
  JSON.parse(
    packageText,
  );

test(
  "Neon migration bootstraps required PostgreSQL extensions before the TINDIO baseline",
  () => {
    assert.match(
      extensions,
      /create extension if not exists pgcrypto/i,
    );

    assert.match(
      extensions,
      /create extension if not exists pg_trgm/i,
    );

    assert.match(
      extensions,
      /with schema extensions/i,
    );
  },
);

test(
  "Neon Data API is configured to verify existing Supabase Auth JWTs",
  () => {
    assert.match(
      neonConfig,
      /dataApi/,
    );

    assert.match(
      neonConfig,
      /authProvider:\s*"external"/,
    );

    assert.match(
      neonConfig,
      /well-known\/jwks\.json/,
    );

    assert.match(
      neonConfig,
      /auth:\s*true/,
    );
  },
);

test(
  "database provider defaults safely to Supabase until explicit Neon cutover",
  () => {
    assert.match(
      databaseEnv,
      /TINDIO_DATABASE_PROVIDER/,
    );

    assert.match(
      databaseEnv,
      /\?\?\s*"supabase"/,
    );

    assert.match(
      databaseEnv,
      /NEON_DATA_API_URL/,
    );
  },
);

test(
  "only Supabase REST database traffic is redirected to Neon",
  () => {
    assert.match(
      dataFetch,
      /\/rest\/v1/,
    );

    assert.match(
      dataFetch,
      /NEON|neon/i,
    );

    assert.match(
      dataFetch,
      /headers\.delete\(\s*"apikey"/,
    );

    assert.match(
      serverClient,
      /createNeonDataApiFetch/,
    );

    assert.match(
      serverClient,
      /createServerClient/,
    );
  },
);

test(
  "Phase 04 removes physical auth.users foreign-key coupling and adds identity provisioning",
  () => {
    assert.match(
      migration,
      /drop constraint if exists profiles_id_fkey/i,
    );

    assert.match(
      migration,
      /organizations_created_by_profile_fkey/i,
    );

    assert.match(
      migration,
      /employee_invitations_accepted_by_profile_fkey/i,
    );

    assert.match(
      migration,
      /ensure_current_identity_profile/i,
    );

    assert.match(
      identityProvider,
      /auth\.user_id\(\)/,
    );

    assert.match(
      identityProvider,
      /auth\.uid\(\)/,
    );

    assert.match(
      identityProvider,
      /auth\.jwt\(\)/,
    );

    assert.doesNotMatch(
      identityProvider,
      /create or replace function auth\.uid\(\)/i,
    );
  },
);

test(
  "authentication lifecycle provisions TINDIO identity explicitly",
  () => {
    assert.match(
      authActions,
      /ensureCurrentIdentityProfile/,
    );

    assert.match(
      authCallback,
      /ensureCurrentIdentityProfile/,
    );
  },
);

test(
  "closed Phase 02 and Phase 03 drift checks are pinned to their historical final commits",
  () => {
    assert.match(
      phase02,
      /PHASE_FINAL_SHA/,
    );

    assert.match(
      phase02,
      /494191999463ba7a34130051344e4b8819c83a43/,
    );

    assert.match(
      phase03,
      /PHASE_FINAL_SHA/,
    );

    assert.match(
      phase03,
      /a0c0665b6822eccfe9527d774a6d4e5c546feb96/,
    );
  },
);

test(
  "Phase 04 scripts are wired without adding a second application database SDK",
  () => {
    for (
      const name
      of [
        "test:phase-04-browser-db-boundary",
        "test:phase-04-neon-baseline",
        "test:phase-04-supabase-jwks",
        "test:phase-04-cookie-neon-auth",
        "test:provider-neutral-time-clock-runtime",
        "certify:phase-04:neon-rehearsal",
        "migrate:phase-04:neon-cutover",
        "certify:phase-04:neon-api",
      ]
    ) {
      assert.equal(
        typeof packageJson
          .scripts[name],
        "string",
      );
    }

    assert.equal(
      packageJson
        .dependencies[
          "@supabase/postgrest-js"
        ],
      undefined,
    );

    assert.equal(
      packageJson
        .dependencies[
          "@neondatabase/serverless"
        ],
      undefined,
    );
  },
);
