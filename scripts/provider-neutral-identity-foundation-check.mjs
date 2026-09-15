import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);

const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith("_provider_neutral_identity_foundation.sql"));

assert.equal(
  migrationNames.length,
  1,
  `Expected exactly one provider-neutral identity foundation migration, found ${migrationNames.length}.`,
);

const [migration, phaseOneMigration, authDal] = await Promise.all([
  readFile(
    new URL(`../supabase/migrations/${migrationNames[0]}`, import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20260820165413_phase_1_business_setup.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(new URL("../src/lib/auth/dal.ts", import.meta.url), "utf8"),
]);

test("R3.1 preserves historical identity-coupling evidence while the current DAL uses stable profile identity", () => {
  assert.match(
    phaseOneMigration,
    /id uuid primary key references auth\.users \(id\) on delete cascade/,
  );

  assert.match(
    phaseOneMigration,
    /created_by uuid not null references auth\.users \(id\) on delete restrict/,
  );

  assert.match(
    phaseOneMigration,
    /profile_id uuid not null references public\.profiles \(id\) on delete restrict/,
  );

  assert.match(
    phaseOneMigration,
    /create or replace function private\.sync_auth_user_profile\(\)/,
  );

  assert.match(phaseOneMigration, /auth\.uid\(\)/);

  assert.doesNotMatch(authDal, /id\s*:\s*data\.claims\.sub/);
  assert.match(authDal, /resolveCurrentProfileId/);
  assert.match(authDal, /const\s+subject\s*=\s+typeof\s+claims\.sub/);
  assert.match(authDal, /\.eq\("profile_id", user\.id\)/);
  assert.match(authDal, /\.eq\("id", user\.id\)/);
});

test("R3.2 creates a private provider-neutral identity bridge", () => {
  assert.match(
    migration,
    /create table private\.identity_links/,
  );

  assert.match(
    migration,
    /provider text not null/,
  );

  assert.match(
    migration,
    /provider_subject text not null/,
  );

  assert.match(
    migration,
    /profile_id uuid not null references public\.profiles \(id\) on delete cascade/,
  );

  assert.match(
    migration,
    /primary key \(provider, provider_subject\)/,
  );

  assert.match(
    migration,
    /unique \(provider, profile_id\)/,
  );

  assert.match(
    migration,
    /create index identity_links_profile_id_idx/,
  );

  assert.match(
    migration,
    /revoke all on table private\.identity_links[\s\S]*public, anon, authenticated, service_role/,
  );
});

test("R3.2 backfills the current Supabase identity relationship explicitly", () => {
  assert.match(
    migration,
    /select[\s\S]*'supabase'[\s\S]*auth_user\.id::text[\s\S]*profile\.id[\s\S]*from auth\.users auth_user[\s\S]*join public\.profiles profile[\s\S]*profile\.id = auth_user\.id/,
  );

  assert.match(
    migration,
    /auth user without TINDIO profile/,
  );

  assert.match(
    migration,
    /missing exact Supabase identity mapping/,
  );

  assert.match(
    migration,
    /invalid Supabase identity mapping/,
  );
});

test("existing auth profile provisioning is preserved and extended additively", () => {
  assert.match(
    migration,
    /create or replace function private\.sync_auth_user_profile\(\)/,
  );

  assert.match(
    migration,
    /insert into public\.profiles \(id, full_name, email\)/,
  );

  assert.match(
    migration,
    /left\(coalesce\(new\.raw_user_meta_data ->> 'full_name', ''\), 160\)/,
  );

  assert.match(
    migration,
    /lower\(coalesce\(new\.email, ''\)\)/,
  );

  assert.match(
    migration,
    /insert into private\.identity_links/,
  );

  assert.match(
    migration,
    /'supabase',[\s\S]*new\.id::text,[\s\S]*new\.id/,
  );

  assert.match(
    migration,
    /on conflict \(provider, provider_subject\) do nothing/,
  );

  assert.match(
    migration,
    /R3 identity synchronization failed/,
  );
});

test("Packet 1 does not advance into later identity-decoupling phases", () => {
  assert.doesNotMatch(
    migration,
    /private\.current_identity_subject/,
  );

  assert.doesNotMatch(
    migration,
    /private\.current_profile_id/,
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
});
