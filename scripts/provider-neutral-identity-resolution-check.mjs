import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

const migrationNames = await readdir(migrationsDirectory);

const resolutionMigrations = migrationNames.filter((name) =>
  name.endsWith("_provider_neutral_identity_resolution_helpers.sql"),
);

const foundationMigrations = migrationNames.filter((name) =>
  name.endsWith("_provider_neutral_identity_foundation.sql"),
);

assert.equal(
  resolutionMigrations.length,
  1,
  `Expected exactly one provider-neutral identity resolution migration, found ${resolutionMigrations.length}.`,
);

assert.equal(
  foundationMigrations.length,
  1,
  `Expected exactly one provider-neutral identity foundation migration, found ${foundationMigrations.length}.`,
);

const [
  migration,
  foundationMigration,
  phaseOneMigration,
  authDal,
] = await Promise.all([
  readFile(
    new URL(
      `../supabase/migrations/${resolutionMigrations[0]}`,
      import.meta.url,
    ),
    "utf8",
  ),

  readFile(
    new URL(
      `../supabase/migrations/${foundationMigrations[0]}`,
      import.meta.url,
    ),
    "utf8",
  ),

  readFile(
    new URL(
      "../supabase/migrations/20260820165413_phase_1_business_setup.sql",
      import.meta.url,
    ),
    "utf8",
  ),

  readFile(
    new URL("../src/lib/auth/dal.ts", import.meta.url),
    "utf8",
  ),
]);

function functionDefinition(name) {
  const match = migration.match(
    new RegExp(
      `create or replace function private\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );

  assert.ok(match, `Missing private.${name}() definition.`);

  return match[0];
}

function functionBody(definition) {
  const match = definition.match(/as\s+\$\$([\s\S]*?)\$\$;/i);

  assert.ok(match, "Unable to extract SQL function body.");

  return match[1];
}

const currentIdentitySubject = functionDefinition(
  "current_identity_subject",
);

const currentProfileId = functionDefinition(
  "current_profile_id",
);

const currentIdentitySubjectBody = functionBody(
  currentIdentitySubject,
);

const currentProfileIdBody = functionBody(
  currentProfileId,
);

test("certified R3 identity foundation remains the source of identity mappings", () => {
  assert.match(
    foundationMigration,
    /create table private\.identity_links/,
  );

  assert.match(
    foundationMigration,
    /provider_subject text not null/,
  );

  assert.match(
    foundationMigration,
    /profile_id uuid not null references public\.profiles \(id\)/,
  );
});

test("current_identity_subject isolates the current Supabase subject", () => {
  assert.match(
    currentIdentitySubject,
    /returns text/,
  );

  assert.match(
    currentIdentitySubject,
    /language sql/,
  );

  assert.match(
    currentIdentitySubject,
    /stable/,
  );

  assert.match(
    currentIdentitySubject,
    /security definer/,
  );

  assert.match(
    currentIdentitySubject,
    /set search_path = ''/,
  );

  assert.equal(
    (currentIdentitySubjectBody.match(/auth\.uid\(\)/g) ?? []).length,
    1,
    "current_identity_subject() must contain exactly one auth.uid() reference.",
  );

  assert.doesNotMatch(
    currentIdentitySubjectBody,
    /identity_links|profiles|employees/,
  );

  assert.match(
    migration,
    /revoke execute[\s\S]*on function private\.current_identity_subject\(\)[\s\S]*from public, anon, authenticated, service_role;/,
  );
});

test("current_profile_id resolves provider identity through the TINDIO identity map", () => {
  assert.match(
    currentProfileId,
    /returns uuid/,
  );

  assert.match(
    currentProfileId,
    /language sql/,
  );

  assert.match(
    currentProfileId,
    /stable/,
  );

  assert.match(
    currentProfileId,
    /security definer/,
  );

  assert.match(
    currentProfileId,
    /set search_path = ''/,
  );

  assert.match(
    currentProfileIdBody,
    /from private\.identity_links identity_link/,
  );

  assert.match(
    currentProfileIdBody,
    /identity_link\.provider = 'supabase'/,
  );

  assert.match(
    currentProfileIdBody,
    /identity_link\.provider_subject\s*=\s*\(select private\.current_identity_subject\(\)\)/,
  );

  assert.doesNotMatch(
    currentProfileIdBody,
    /auth\.uid\(\)/,
  );

  assert.match(
    migration,
    /revoke execute[\s\S]*on function private\.current_profile_id\(\)[\s\S]*from public, anon, authenticated, service_role;/,
  );
});

test("provider-specific auth.uid coupling is isolated to the subject adapter", () => {
  assert.equal(
    (migration.match(/auth\.uid\(\)/g) ?? []).length,
    1,
    "The new migration must contain exactly one auth.uid() reference.",
  );

  assert.doesNotMatch(
    currentProfileIdBody,
    /raise\s+exception/i,
  );

  assert.doesNotMatch(
    currentProfileIdBody,
    /::\s*uuid/i,
  );
});

test("Packet 2 does not migrate business authorization or application identity yet", () => {
  const createdPrivateFunctions = [
    ...migration.matchAll(
      /create or replace function private\.([a-z0-9_]+)\(/gi,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(
    createdPrivateFunctions.sort(),
    [
      "current_identity_subject",
      "current_profile_id",
    ].sort(),
  );

  assert.doesNotMatch(
    migration,
    /\b(create|alter|drop)\s+policy\b/i,
  );

  assert.doesNotMatch(
    migration,
    /alter table public\.(profiles|organizations|employees)/i,
  );

  assert.doesNotMatch(
    migration,
    /\bdrop\s+(table|function|trigger|constraint)\b/i,
  );

  assert.match(
    phaseOneMigration,
    /auth\.uid\(\)/,
  );

  assert.match(
    authDal,
    /id: data\.claims\.sub/,
  );

  assert.match(
    authDal,
    /\.eq\("profile_id", user\.id\)/,
  );

  assert.match(
    authDal,
    /\.eq\("id", user\.id\)/,
  );
});
