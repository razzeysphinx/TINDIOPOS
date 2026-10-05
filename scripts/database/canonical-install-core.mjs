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
const HISTORICAL_ARCHIVE_SOURCE_COMMIT = "761effb81a0784ded8b56adad2d93e1dc72d8193";
const HISTORICAL_ARCHIVE_SOURCE_TREE = "0b5f2ba5d5abeca8b0d451515c6deaac1b4ea70e";

// The manifest certifies canonical LF bytes. Git may materialize a text file
// with CRLF on Windows before the repository's eol rule reaches an existing
// worktree, so restore the certified representation before hashing or sending
// the baseline to a database. This is a byte-normalization boundary, not a
// schema transformation.
export function canonicalBaselineText(source) {
  return source.replace(/\r\n/g, "\n");
}

function gitBytes(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function gitText(args) {
  return gitBytes(args).toString("utf8").trim();
}

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
  const [baselineSource, manifestSource, migrations] = await Promise.all([
    readFile(BASELINE_PATH, "utf8"),
    readFile(MANIFEST_PATH, "utf8"),
    canonicalMigrationFiles(),
  ]);
  const baseline = canonicalBaselineText(baselineSource);
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

  const sourceTree = gitText([
    "rev-parse",
    `${HISTORICAL_ARCHIVE_SOURCE_COMMIT}:${manifest.sourceDirectory}`,
  ]);
  assert.equal(
    sourceTree,
    HISTORICAL_ARCHIVE_SOURCE_TREE,
    "Certified R8 historical migration source tree changed unexpectedly.",
  );

  const archiveTree = gitText(["rev-parse", `HEAD:${manifest.archiveDirectory}`]);
  assert.equal(
    archiveTree,
    sourceTree,
    "Historical migration archive differs from the certified R8 Git tree.",
  );

  const dirtyArchive = gitText([
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    manifest.archiveDirectory,
  ]);
  assert.equal(
    dirtyArchive,
    "",
    "Historical migration archive contains uncommitted working-tree changes.",
  );

  for (const migration of manifest.migrations) {
    const source = gitBytes(["cat-file", "blob", `HEAD:${migration.archivePath}`]);
    const sha256 = createHash("sha256").update(source).digest("hex");
    assert.equal(sha256, migration.sha256, `Historical archive hash mismatch: ${migration.archivePath}`);
  }
}
