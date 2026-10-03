import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const ROOT = process.cwd();
export const BASELINE_PATH = "database/baseline/0001_tindio_baseline.sql";
export const MANIFEST_PATH = "database/baseline/0001_tindio_baseline.manifest.json";
export const MIGRATIONS_DIRECTORY = "database/migrations";
export const HISTORICAL_ARCHIVE_MANIFEST = "archive/database/supabase-migrations.manifest.json";

const CANONICAL_MIGRATION_PATTERN = /^(?<number>\d{4})_.+\.sql$/u;

export async function canonicalMigrationFiles() {
  const names = (await readdir(MIGRATIONS_DIRECTORY))
    .filter((name) => CANONICAL_MIGRATION_PATTERN.test(name))
    .sort();

  assert.ok(names.length > 0, "Canonical forward migrations are required.");

  const numbers = names.map((name) => CANONICAL_MIGRATION_PATTERN.exec(name).groups.number);
  assert.equal(new Set(numbers).size, numbers.length, "Canonical migration numbers must be unique.");

  return names;
}

export async function loadCanonicalInstall() {
  const [baseline, manifestSource, migrations] = await Promise.all([
    readFile(BASELINE_PATH, "utf8"),
    readFile(MANIFEST_PATH, "utf8"),
    canonicalMigrationFiles(),
  ]);
  const manifest = JSON.parse(manifestSource);
  const baselineSha256 = createHash("sha256").update(baseline).digest("hex");

  assert.equal(
    baselineSha256,
    manifest.baselineSha256,
    "Canonical baseline hash differs from its manifest.",
  );

  return {
    baseline,
    baselineSha256,
    manifest,
    migrations: await Promise.all(
      migrations.map(async (name) => ({
        name,
        sql: await readFile(path.join(MIGRATIONS_DIRECTORY, name), "utf8"),
      })),
    ),
  };
}

export async function providerSql(provider, name) {
  assert.ok(["local", "neon"].includes(provider), "Unsupported database provider.");
  return readFile(path.join("database/provider", provider, name), "utf8");
}

export async function verifyHistoricalMigrationArchive() {
  let activeExists = true;
  try {
    await access("supabase/migrations");
  } catch {
    activeExists = false;
  }
  assert.equal(activeExists, false, "Historical migrations must not remain on the active Supabase CLI path.");

  const manifest = JSON.parse(await readFile(HISTORICAL_ARCHIVE_MANIFEST, "utf8"));
  assert.equal(manifest.migrationCount, manifest.migrations.length, "Historical archive manifest count is inconsistent.");
  assert.ok(manifest.migrationCount > 0, "Historical archive manifest is empty.");

  for (const migration of manifest.migrations) {
    // Hash the committed blob, not checkout bytes that may be rewritten by
    // core.autocrlf. The archive contract protects repository history.
    const source = execFileSync("git", ["show", `HEAD:${migration.archivePath}`], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    const sha256 = createHash("sha256").update(source).digest("hex");
    assert.equal(sha256, migration.sha256, `Historical archive hash mismatch: ${migration.archivePath}`);
  }
}
