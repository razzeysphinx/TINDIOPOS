import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalMigrationFiles, loadCanonicalInstall, verifyHistoricalMigrationArchive } from "./canonical-install-core.mjs";

test("canonical install files are ordered and manifest-backed", async () => {
  const migrations = await canonicalMigrationFiles();
  const install = await loadCanonicalInstall();
  assert.deepEqual(install.migrations.map(({ name }) => name), migrations);
  assert.equal(install.manifest.baselineSha256, install.baselineSha256);
});

test("permanent install tooling is provider-safe and recovery-neutral", async () => {
  const [localRoles, localIdentity, neonExtensions, neonRoles, neonIdentity, packageSource, readme] = await Promise.all([
    readFile("database/provider/local/00_roles.sql", "utf8"),
    readFile("database/provider/local/01_identity.sql", "utf8"),
    readFile("database/provider/neon/00_extensions.sql", "utf8"),
    readFile("database/provider/neon/00_roles.sql", "utf8"),
    readFile("database/provider/neon/01_identity.sql", "utf8"),
    readFile("package.json", "utf8"),
    readFile("README.md", "utf8"),
  ]);
  for (const source of [localRoles, localIdentity, neonExtensions, neonRoles, neonIdentity]) assert.ok(source.length > 0);
  const permanent = await Promise.all([
    readFile("scripts/database/canonical-install-core.mjs", "utf8"),
    readFile("scripts/database/install-local.mjs", "utf8"),
    readFile("scripts/database/install-neon.mjs", "utf8"),
  ]);
  assert.doesNotMatch(permanent.join("\n"), /divine-sound|wandering-voice|r6-clean-canonical|tindio_r6_recovery|2026-10-02/i);
  assert.match(packageSource, /"db:install:local"/);
  assert.match(packageSource, /"db:install:neon"/);
  assert.match(packageSource, /"test:db:canonical-install"/);
  assert.match(readme, /Neon PostgreSQL/i);
  assert.match(readme, /database\/baseline/i);
});

test("historical migrations are inactive and byte-preserved in the archive", async () => {
  await verifyHistoricalMigrationArchive();
});

test("Neon installation checks its provider-owned identity prerequisite before schema writes", async () => {
  const neonInstaller = await readFile("scripts/database/install-neon.mjs", "utf8");
  const providerPrerequisite = neonInstaller.indexOf("provider identity prerequisite");
  const emptyTargetGuard = neonInstaller.indexOf("empty-target guard");
  assert.ok(providerPrerequisite >= 0, "Neon installer must identify its provider identity prerequisite.");
  assert.ok(emptyTargetGuard >= 0, "Neon installer must retain its empty-target guard.");
  assert.ok(providerPrerequisite < emptyTargetGuard, "Neon identity prerequisite must run before any schema installation.");
  assert.match(neonInstaller, /to_regprocedure\('auth\.user_id\(\)'\)/);
  assert.match(neonInstaller, /to_regprocedure\('auth\.jwt\(\)'\)/);
});
