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
  route,
  context,
  client,
  migration,
] =
  await Promise.all([
    source(
      "src/app/api/pos/v2/bootstrap/route.ts",
    ),
    source(
      "src/lib/auth/pos-v2-context.ts",
    ),
    source(
      "src/lib/supabase/pos-v2-database-client.ts",
    ),
    source(
      "supabase/migrations/20260924_phase_04_pos_bootstrap_v2_core.sql",
    ),
  ]);

test(
  "V2 core does not use the V1 workspace loader",
  () => {
    assert.match(
      context,
      /get_pos_bootstrap_core_v2/,
    );

    assert.doesNotMatch(
      route,
      new RegExp(
        [
          "loadPos",
          "Workspace",
        ].join(""),
      ),
    );

    assert.doesNotMatch(
      context,
      /loadBusinessContext/,
    );
  },
);

test(
  "V2 distinguishes authentication, authorization, and backend failure",
  () => {
    assert.match(
      context,
      /status:\s*401/,
    );

    assert.match(
      context,
      /status:\s*403/,
    );

    assert.match(
      context,
      /status:\s*503/,
    );

    assert.match(
      context,
      /DATABASE_UNAVAILABLE/,
    );

    assert.match(
      context,
      /status >= 400[\s\S]*status < 500[\s\S]*status !== 429/,
    );
  },
);

test(
  "V2 uses an explicit-token stateless DB client",
  () => {
    assert.match(
      client,
      /createClient as createSupabaseClient/,
    );

    assert.match(
      client,
      /accessToken:[\s\S]*async[\s\S]*accessToken/,
    );

    assert.doesNotMatch(
      client,
      /createServerClient/,
    );
  },
);

test(
  "V2 retries only a transient identity-mapping envelope",
  () => {
    assert.match(
      client,
      /retryPosV2IdentityUnmapped/,
    );

    assert.match(
      client,
      /payload\.reason === "IDENTITY_UNMAPPED"/,
    );

    assert.match(
      client,
      /first\.error[\s\S]*!isIdentityUnmapped\(first\.data\)[\s\S]*return first[\s\S]*return request\(\)/,
    );

    assert.match(
      context,
      /retryPosV2IdentityUnmapped\([\s\S]*get_pos_bootstrap_core_v2/,
    );
  },
);

test(
  "V2 identity cannot be supplied by the browser",
  () => {
    assert.match(
      migration,
      /private\.current_profile_id\(\)/,
    );

    assert.doesNotMatch(
      migration,
      /target_profile_id/,
    );

    assert.doesNotMatch(
      migration,
      /target_employee_id/,
    );
  },
);
