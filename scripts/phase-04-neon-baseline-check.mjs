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
  baseline,
  roles,
  extensions,
  identity,
  migration,
] =
  await Promise.all([
    source(
      "database/baseline/0001_tindio_baseline.sql",
    ),
    source(
      "database/provider/neon/00_roles.sql",
    ),
    source(
      "database/provider/neon/00_extensions.sql",
    ),
    source(
      "database/provider/neon/01_identity.sql",
    ),
    source(
      "supabase/migrations/20260922180000_neon_portability_foundation.sql",
    ),
  ]);

test(
  "canonical TINDIO baseline has no physical Supabase auth.users dependency",
  () => {
    assert.doesNotMatch(
      baseline,
      /\bauth\.users\b/i,
    );

    assert.match(
      baseline,
      /ensure_current_identity_profile/i,
    );
  },
);

test(
  "Neon provider supplies compatible database roles without login credentials",
  () => {
    for (
      const role
      of [
        "authenticated",
        "anon",
        "service_role",
      ]
    ) {
      assert.match(
        roles,
        new RegExp(
          `create role ${role}[\\s\\S]*nologin`,
          "i",
        ),
      );
    }
  },
);

test(
  "Neon identity adapter bridges verified Data API subject into TINDIO identity",
  () => {
    assert.match(
      identity,
      /auth\.user_id\(\)/,
    );

    assert.doesNotMatch(
      identity,
      /create or replace function auth\.(?:uid|jwt|session|user_id)\s*\(/i,
      "TINDIO must not replace provider-owned Neon JWT helper functions",
    );

    for (
      const helper
      of [
        "auth.user_id()",
        "auth.uid()",
        "auth.jwt()",
        "auth.session()",
      ]
    ) {
      assert.match(
        identity,
        new RegExp(
          helper
            .replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&",
            ),
        ),
        `${helper} must be verified by the Neon provider adapter`,
      );
    }

    assert.match(
      identity,
      /private\.current_identity_subject\(\)/,
    );
  },
);

test(
  "portability migration preserves profile identity while removing auth.users foreign keys",
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
      /references public\.profiles \(id\)/i,
    );

    assert.match(
      migration,
      /employee_invitations_accepted_by_profile_fkey/i,
    );

    assert.match(
      migration,
      /foreign key \(accepted_by\)[\s\S]*references public\.profiles \(id\)/i,
    );

    assert.match(
      migration,
      /ensure_current_identity_profile/i,
    );
  },
);

test(
  "canonical baseline contains no source provider ownership or administrative ACL metadata",
  () => {
    assert.doesNotMatch(
      baseline,
      /\bOWNER\s+TO\b/i,
    );

    assert.doesNotMatch(
      baseline,
      /\bSET\s+SESSION\s+AUTHORIZATION\b/i,
    );

    assert.doesNotMatch(
      baseline,
      /^[ \t]*ALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bFOR\s+(?:ROLE|USER)\s+"?(?:postgres|supabase_admin)"?\b[^;]*;/im,
    );

    assert.doesNotMatch(
      baseline,
      /^[ \t]*(?:GRANT|REVOKE)\b[^;]*\b(?:TO|FROM)\s+"?(?:postgres|supabase_admin)"?\b[^;]*;/im,
    );

    assert.doesNotMatch(
      baseline,
      /^[ \t]*(?:GRANT|REVOKE)\b[^;]*\bGRANTED\s+BY\s+"?(?:postgres|supabase_admin)"?\b[^;]*;/im,
    );
  },
);

test(
  "canonical baseline preserves TINDIO application authorization",
  () => {
    assert.match(
      baseline,
      /\bTO\s+"?authenticated"?\b/i,
    );

    assert.match(
      baseline,
      /\bTO\s+"?service_role"?\b/i,
    );

    assert.match(
      baseline,
      /\bROW\s+LEVEL\s+SECURITY\b/i,
    );

    assert.match(
      baseline,
      /\bCREATE\s+POLICY\b/i,
    );
  },
);

test(
  "Neon provider recreates TINDIO pgcrypto extension surface",
  () => {
    assert.match(
      extensions,
      /create schema if not exists extensions/i,
    );

    assert.match(
      extensions,
      /create extension if not exists pgcrypto[\s\S]*with schema extensions/i,
    );

    assert.match(
      extensions,
      /extensions\.crypt\(text,text\)/i,
    );

    assert.match(
      extensions,
      /extensions\.gen_salt\(text,integer\)/i,
    );

    assert.match(
      extensions,
      /extensions\.digest\(text,text\)/i,
    );
  },
);
