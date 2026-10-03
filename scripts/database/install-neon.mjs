import assert from "node:assert/strict";
import { runSql, restoreSql } from "../lib/phase-04-postgres-docker.mjs";
import { loadCanonicalInstall, providerSql } from "./canonical-install-core.mjs";

function directNeonUrl() {
  assert.equal(process.env.TINDIO_DATABASE_INSTALL, "YES", "Set TINDIO_DATABASE_INSTALL=YES to authorize an isolated Neon installation.");
  assert.equal(process.env.TINDIO_DATABASE_PROVIDER, "neon", "Set TINDIO_DATABASE_PROVIDER=neon.");
  assert.ok(process.env.DATABASE_URL_UNPOOLED, "DATABASE_URL_UNPOOLED is required.");

  const parsed = new URL(process.env.DATABASE_URL_UNPOOLED);
  assert.equal(parsed.protocol, "postgresql:", "Neon installation requires a PostgreSQL URL.");
  assert.ok(parsed.hostname.endsWith(".neon.tech"), "Neon installation requires a Neon hostname.");
  assert.ok(!parsed.hostname.includes("-pooler"), "Neon installation requires a direct, non-pooler endpoint.");

  if (process.env.TINDIO_EXPECTED_NEON_HOST) {
    assert.equal(parsed.hostname, process.env.TINDIO_EXPECTED_NEON_HOST, "Unexpected Neon endpoint host.");
  }
  if (process.env.TINDIO_EXPECTED_DATABASE_NAME) {
    assert.equal(decodeURIComponent(parsed.pathname.slice(1)), process.env.TINDIO_EXPECTED_DATABASE_NAME, "Unexpected Neon database.");
  }
  return process.env.DATABASE_URL_UNPOOLED;
}

async function main() {
  const url = directNeonUrl();
  console.log("TINDIO CANONICAL NEON INSTALL: provider identity prerequisite");
  assert.equal(
    runSql(
      url,
      "select to_regprocedure('auth.user_id()') is not null and to_regprocedure('auth.jwt()') is not null;",
    ),
    "t",
    "Neon Auth runtime is required before installing the canonical identity adapter. Configure the isolated provider target before retrying.",
  );
  console.log("TINDIO CANONICAL NEON INSTALL: empty-target guard");
  assert.equal(runSql(url, "select to_regclass('public.organizations') is null;"), "t", "Refusing to install over a non-empty Neon database.");

  const install = await loadCanonicalInstall();
  console.log("TINDIO CANONICAL NEON INSTALL: provider extensions");
  restoreSql(url, await providerSql("neon", "00_extensions.sql"));
  console.log("TINDIO CANONICAL NEON INSTALL: baseline");
  restoreSql(url, install.baseline);
  console.log("TINDIO CANONICAL NEON INSTALL: role adapter");
  restoreSql(url, await providerSql("neon", "00_roles.sql"));
  for (const migration of install.migrations) {
    console.log(`TINDIO CANONICAL NEON INSTALL: ${migration.name}`);
    restoreSql(url, migration.sql);
  }
  console.log("TINDIO CANONICAL NEON INSTALL: identity adapter");
  restoreSql(url, await providerSql("neon", "01_identity.sql"));

  console.log(JSON.stringify({
    provider: "neon",
    baselineSha256: install.baselineSha256,
    migrations: install.migrations.map(({ name }) => name),
  }, null, 2));
  console.log("TINDIO CANONICAL NEON INSTALL: PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
