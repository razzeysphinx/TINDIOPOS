import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const migrationNamePattern = /^\d+_current_profile_identity_rpc\.sql$/;
const migrationNames = (await readdir(migrationsDirectory)).filter((name) => migrationNamePattern.test(name));

test("current-profile RPC migration exists exactly once", () => {
  assert.deepEqual(migrationNames.length, 1);
});

const migrationName = migrationNames[0];
const migration = await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), "utf8");
const identity = await readFile(new URL("../src/lib/auth/identity.ts", import.meta.url), "utf8");
const dal = await readFile(new URL("../src/lib/auth/dal.ts", import.meta.url), "utf8");
const databaseTypes = await readFile(new URL("../src/lib/supabase/database.types.ts", import.meta.url), "utf8");
const runtimeTest = await readFile(
  new URL("../supabase/tests/database/provider_neutral_application_identity.test.sql", import.meta.url),
  "utf8",
);

test("public.current_profile_id has zero arguments", () => {
  assert.match(migration, /create\s+or\s+replace\s+function\s+public\.current_profile_id\(\s*\)/i);
});

test("public RPC delegates only to the private current-profile helper", () => {
  assert.match(migration, /select\s+private\.current_profile_id\(\)/i);
  assert.doesNotMatch(migration, /auth\.uid\(\)/i);
});

test("public RPC is stable, definer-secured, and search-path hardened", () => {
  assert.match(migration, /language\s+sql\s+stable\s+security\s+definer\s+set\s+search_path\s*=\s*''/i);
});

test("public RPC has least-privilege execute grants", () => {
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.current_profile_id\(\)\s+from\s+public/i);
  assert.match(migration, /revoke\s+all\s+on\s+function\s+public\.current_profile_id\(\)\s+from\s+anon/i);
  assert.match(migration, /grant\s+execute\s+on\s+function\s+public\.current_profile_id\(\)\s+to\s+authenticated/i);
});

test("identity adapter resolves only the current authenticated profile", () => {
  assert.match(identity, /resolveCurrentProfileId/);
  assert.match(identity, /\.rpc\("current_profile_id"\)/);
  assert.doesNotMatch(identity, /provider_subject/);
  assert.doesNotMatch(identity, /subject\s*:/);
});

test("DAL assigns provider subject separately from stable business identity", () => {
  assert.match(dal, /const\s+subject\s*=\s+typeof\s+claims\.sub/);
  assert.match(dal, /const\s+id\s*=\s+await\s+resolveCurrentProfileId\(supabase\)/);
  assert.doesNotMatch(dal, /id\s*:\s*(?:data\.)?claims\.sub/);
});

test("VerifiedUser carries both stable id and provider subject", () => {
  assert.match(dal, /export\s+type\s+VerifiedUser\s*=\s*\{[\s\S]*?id:\s*string;[\s\S]*?subject:\s*string;/);
});

test("business membership and profile queries retain the stable user id", () => {
  assert.match(dal, /\.eq\("profile_id",\s*user\.id\)/);
  assert.match(dal, /\.eq\("id",\s*user\.id\)/);
});

test("generated database types expose the zero-argument current-profile RPC", () => {
  assert.match(databaseTypes, /current_profile_id:\s*\{[\s\S]*?Returns:\s*string/);
});

test("deterministic runtime test certifies split identity resolution and rollback", () => {
  assert.match(runtimeTest, /insert\s+into\s+auth\.users/i);
  assert.match(runtimeTest, /set\s+local\s+request\.jwt\.claim\.sub/i);
  assert.match(runtimeTest, /set\s+local\s+role\s+authenticated/i);
  assert.match(runtimeTest, /private\.identity_links/);
  assert.match(
    runtimeTest,
    /provider_subject[\s\S]*91000000-0000-4000-8000-000000000001[\s\S]*profile_id[\s\S]*91000000-0000-4000-8000-000000000002/i,
  );
  assert.match(runtimeTest, /public\.current_profile_id\(\)/);
  assert.match(runtimeTest, /unmapped provider subject fails closed/i);
  assert.match(runtimeTest, /rollback;/i);
});

test("new migration does not alter policy, business tables, or historical migrations", () => {
  assert.doesNotMatch(migration, /drop\s+(table|column|policy)|alter\s+table[\s\S]*?drop|truncate|create\s+policy/i);
  const gitStatus = process.platform === "win32"
    ? execFileSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "git status --porcelain -- supabase/migrations"], {
      cwd: process.cwd(),
      encoding: "utf8",
    })
    : execFileSync("git", ["status", "--porcelain", "--", "supabase/migrations"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
  const changedMigrationPaths = gitStatus
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3));
  assert.deepEqual(changedMigrationPaths, [`supabase/migrations/${migrationName}`]);
});
