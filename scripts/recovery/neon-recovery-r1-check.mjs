import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sourceOfTruth = readFileSync("docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md", "utf8");
const preflight = readFileSync("scripts/recovery/neon-recovery-preflight.mjs", "utf8");
const r1 = readFileSync("scripts/recovery/neon-recovery-r1-schema-diff.mjs", "utf8");

test("recovery source of truth preserves protected architecture", () => {
  assert.match(sourceOfTruth, /inventory ledger/i);
  assert.match(sourceOfTruth, /tenant isolation/i);
  assert.match(sourceOfTruth, /There is NO Mobile Phase 27/i);
  assert.match(sourceOfTruth, /Supabase Auth/i);
  assert.match(sourceOfTruth, /Neon/i);
});

test("preflight pins recovery ancestry and direct Neon evidence target", () => {
  assert.match(preflight, /2d48e2ead33d783aef6c61dedb661ba74714ea9a/);
  assert.match(preflight, /recovery\/neon-canonical-rebuild/);
  assert.match(preflight, /DATABASE_URL_UNPOOLED/);
  assert.match(preflight, /211/);
});

test("R1 compares schema metadata without live mutation helpers", () => {
  assert.match(r1, /READ_ONLY_SCHEMA_COMPARISON/);
  assert.match(r1, /runSql/);
  assert.doesNotMatch(r1, /\brestoreSql\b/);
  assert.doesNotMatch(r1, /\b(?:insert|update|delete|truncate|alter|drop|create)\s+(?:table|schema|index|policy|function|trigger|sequence)\b/i);
});

test("R1 captures all core schema object classes", () => {
  for (const name of ["tables", "columns", "constraints", "functions", "indexes", "policies", "triggers", "sequences", "extensions"]) {
    assert.match(r1, new RegExp(`${name}:`));
  }
});
