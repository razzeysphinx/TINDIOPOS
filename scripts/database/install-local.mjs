import assert from "node:assert/strict";
import { runCommand } from "../lib/run-command.mjs";
import { restoreSql } from "../lib/phase-04-postgres-docker.mjs";
import { parseAndValidateLocalSupabaseStatus } from "../lib/certification-safety.mjs";
import { loadCanonicalInstall, providerSql } from "./canonical-install-core.mjs";

function localDatabaseUrl() {
  const result = runCommand(
    "pnpm",
    ["exec", "supabase", "status", "--output", "json"],
    { cwd: process.cwd(), env: process.env, capture: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || "Local Supabase is not running.");
  }

  const status = JSON.parse(String(result.stdout));
  parseAndValidateLocalSupabaseStatus(String(result.stdout));
  return status.DB_URL;
}

async function main() {
  assert.equal(
    process.env.TINDIO_DATABASE_INSTALL,
    "YES",
    "Set TINDIO_DATABASE_INSTALL=YES to reset the disposable local database.",
  );

  const url = localDatabaseUrl();
  const parsed = new URL(url);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase()),
    "Canonical local installation requires a loopback database target.",
  );

  const install = await loadCanonicalInstall();

  // Supabase supplies auth, extension, and provider runtime infrastructure.
  // TINDIO owns only these disposable application schemas on the local target.
  restoreSql(url, `
    drop schema if exists private cascade;
    drop schema if exists public cascade;
    create schema public;
  `);
  restoreSql(url, await providerSql("local", "00_extensions.sql"));
  restoreSql(url, install.baseline);
  restoreSql(url, await providerSql("local", "00_roles.sql"));
  for (const migration of install.migrations) restoreSql(url, migration.sql);
  restoreSql(url, await providerSql("local", "01_identity.sql"));

  console.log(JSON.stringify({
    provider: "local",
    host: parsed.hostname,
    baselineSha256: install.baselineSha256,
    migrations: install.migrations.map(({ name }) => name),
  }, null, 2));
  console.log("TINDIO CANONICAL LOCAL INSTALL: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
