import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const baseline = readFileSync("database/baseline/0001_tindio_baseline.sql", "utf8");
const migration = readFileSync("database/migrations/0002_provider_neutral_business_identity.sql", "utf8");
const localAdapter = readFileSync("database/provider/local/01_identity.sql", "utf8");
const neonAdapter = readFileSync("database/provider/neon/01_identity.sql", "utf8");
const manifest = JSON.parse(readFileSync("database/baseline/0001_tindio_baseline.manifest.json", "utf8"));
const n = (source, pattern) => (source.match(pattern) ?? []).length;
const executable = (source) => source.replace(/'(?:''|[^'])*'/g, "");

test("canonical business SQL has no direct identity-provider primitive", () => {
  assert.equal(n(baseline, /\bauth\.uid\s*\(/gi), 0);
  assert.equal(n(baseline, /\bauth\.user_id\s*\(/gi), 0);
  assert.equal(n(baseline, /\bauth\.jwt\s*\(/gi), 0);
  const r4Complete =
    manifest
      .r4RoleSecurityNormalization
      ?.status
    === "COMPLETE";

  assert.equal(
    n(
      baseline,
      /\bauth\.role\s*\(/gi,
    ),
    r4Complete
      ? 0
      : 1,
  );
});
test("canonical R3 migration contains all complete rewritten definitions", () => {
  assert.equal(n(migration, /\bauth\.uid\s*\(/gi), 0);
  assert.equal(n(migration, /\bauth\.jwt\s*\(/gi), 0);
  assert.equal(n(migration, /CREATE\s+OR\s+REPLACE\s+FUNCTION/gi), 133);
  assert.match(migration, /private\.current_profile_id\s*\(/i);
  assert.match(migration, /private\.current_identity_email\s*\(/i);
  assert.doesNotMatch(migration, /grant execute on function private\.current_profile_id\(\) to authenticated;/i);
});
test("local provider adapter owns local provider helpers", () => {
  assert.equal(n(executable(localAdapter), /\bauth\.uid\s*\(/gi), 1);
  assert.equal(n(executable(localAdapter), /\bauth\.jwt\s*\(/gi), 1);
  assert.equal(n(executable(localAdapter), /\bauth\.user_id\s*\(/gi), 0);
});
test("Neon provider adapter owns Neon provider helpers", () => {
  assert.equal(n(executable(neonAdapter), /\bauth\.user_id\s*\(/gi), 1);
  assert.equal(n(executable(neonAdapter), /\bauth\.jwt\s*\(/gi), 1);
  assert.equal(n(executable(neonAdapter), /\bauth\.uid\s*\(/gi), 0);
});
test("manifest records the full R3 rewrite", () => {
  const r3 = manifest.r3ProviderNeutralIdentity;
  assert.equal(r3.status, "COMPLETE");
  assert.equal(r3.sourceDirectAuthUidFunctions, 132);
  assert.equal(r3.sourceAuthUidReferences, 167);
  assert.equal(r3.businessFunctionsRewritten, 131);
  assert.equal(r3.baselineAuthUidReferencesAfter, 0);
  assert.equal(r3.baselineAuthUserIdReferencesAfter, 0);
  assert.equal(r3.baselineAuthJwtReferencesAfter, 0);
  assert.equal(r3.baselineAuthRoleReferencesDeferredToR4, 1);
});
