import assert from "node:assert/strict";
import process from "node:process";

import {
  createClient,
} from "@supabase/supabase-js";

import {
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

function fail(
  message,
) {
  console.error(
    message,
  );

  process.exit(1);
}

function required(
  name,
) {
  const value =
    process.env[name];

  if (
    typeof value !== "string"
    || value.trim() === ""
  ) {
    fail(
      `${name} is required.`,
    );
  }

  return value.trim();
}

function normalizeHost(
  hostname,
) {
  return hostname
    .replace(
      /^\[/,
      "",
    )
    .replace(
      /\]$/,
      "",
    )
    .toLowerCase();
}

const sourceUrl =
  required(
    "TINDIO_SOURCE_DATABASE_URL",
  );

const targetUrl =
  required(
    "DATABASE_URL_UNPOOLED",
  );

const neonDataApiUrl =
  required(
    "NEON_DATA_API_URL",
  );

const supabaseUrl =
  required(
    "NEXT_PUBLIC_SUPABASE_URL",
  );

const publishableKey =
  required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

const email =
  required(
    "TINDIO_PHASE_04_TEST_EMAIL",
  );

const password =
  required(
    "TINDIO_PHASE_04_TEST_PASSWORD",
  );

const source =
  new URL(
    sourceUrl,
  );

const target =
  new URL(
    targetUrl,
  );

const dataApi =
  new URL(
    neonDataApiUrl,
  );

const sourceHost =
  normalizeHost(
    source.hostname,
  );

const targetHost =
  normalizeHost(
    target.hostname,
  );

assert.ok(
  ![
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
  ].includes(
    sourceHost,
  ),
  "PREPRODUCTION cutover source must not be the local Supabase database.",
);

assert.ok(
  !sourceHost
    .endsWith(
      ".neon.tech",
    ),
  "PREPRODUCTION source unexpectedly points to Neon. Source/target may be reversed.",
);

assert.ok(
  targetHost
    .endsWith(
      ".neon.tech",
    ),
  "DATABASE_URL_UNPOOLED must point to Neon.",
);

assert.ok(
  !targetHost.includes(
    "-pooler",
  ),
  "DATABASE_URL_UNPOOLED must use the direct Neon endpoint.",
);

assert.notEqual(
  sourceUrl,
  targetUrl,
  "Source and target database URLs must differ.",
);

assert.ok(
  dataApi.protocol
    === "https:",
  "NEON_DATA_API_URL must use HTTPS.",
);

const sourceEvidence =
  JSON.parse(
    runSql(
      sourceUrl,
      `
select jsonb_build_object(
  'organizations',
    to_regclass(
      'public.organizations'
    ) is not null,

  'profiles',
    to_regclass(
      'public.profiles'
    ) is not null,

  'identity_links',
    to_regclass(
      'private.identity_links'
    ) is not null,

  'supabase_auth_users',
    to_regclass(
      'auth.users'
    ) is not null
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
    sourceEvidence,
  )
) {
  assert.equal(
    value,
    true,
    `Source PREPRODUCTION database check failed: ${key}`,
  );
}

const targetEmpty =
  runSql(
    targetUrl,
    `
select
  to_regclass(
    'public.organizations'
  ) is null;
`,
  );

assert.equal(
  targetEmpty,
  "t",
  "Neon PREPRODUCTION target must be fresh and empty.",
);

const auth =
  createClient(
    supabaseUrl,
    publishableKey,
    {
      auth: {
        persistSession:
          false,

        autoRefreshToken:
          false,
      },
    },
  );

const {
  data,
  error,
} =
  await auth.auth
    .signInWithPassword({
      email,
      password,
    });

if (
  error
  || !data.session
  || !data.user
) {
  fail(
    `PREPRODUCTION test authentication failed: ${error?.message ?? "missing authenticated session"}`,
  );
}

const {
  data: profileId,
  error: profileError,
} =
  await auth.rpc(
    "current_profile_id",
  );

if (
  profileError
  || typeof profileId !== "string"
  || profileId.length === 0
) {
  fail(
    "PREPRODUCTION test account does not resolve a stable TINDIO profile in the source database.",
  );
}

await auth.auth
  .signOut();

console.log(
  "PHASE 04 CUTOVER PREREQUISITES: PASS",
);
