import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("planned E6 adversarial harness covers every fail-closed class and cleanup", async () => {
  const source = await read("scripts/phase-e-adversarial-rls-proof.mjs");
  for (const marker of [
    "crossTenantFilterReturnedZeroRows",
    "forgedOrganizationHeaderDidNotExpandScope",
    "malformedJwtDenied",
    "tamperedJwtDenied",
    "ERR_JWT_EXPIRED",
    "removedIdentityLinkResolvedNull",
    "revokedIdentityRlsReturnedZeroRows",
    "temporaryRowsRemaining",
    "syntheticUserRemoved",
    "originalAuthConfigurationRestored",
  ]) assert.match(source, new RegExp(marker));
  assert.match(source, /disable trigger organizations_seed_approval_rules/);
  assert.match(source, /enable trigger organizations_seed_approval_rules/);
  assert.doesNotMatch(source, /console\.log\([^)]*(?:password|token|cookie)/i);
});

test("planned E6 rollback restores both Supabase surfaces without custody deletion", async () => {
  const source = await read("scripts/phase-e-supabase-rollback-proof.mjs");
  assert.match(source, /resolveWebAuthProvider\(undefined\)/);
  assert.match(source, /provider: "supabase"/);
  assert.equal((source.match(/signInWithPassword/g) ?? []).length, 2);
  assert.match(source, /signOut\(\{ scope: "local" \}\)/);
  assert.match(source, /tindio\.pos\.device\.rollback-org/);
  assert.match(source, /tindio\.auth\.neon\.session-cookie\.v1/);
  assert.match(source, /outboxEvents/);
});

test("Phase E closes exactly thirteen direct proof flows", async () => {
  const [matrixSource, rlsSource, rollbackSource, closure, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"),
    read("docs/architecture/TINDIO_PHASE_E_PLANNED_E6_ADVERSARIAL_RLS_PROOF.json"),
    read("docs/architecture/TINDIO_PHASE_E_PLANNED_E6_SUPABASE_ROLLBACK_PROOF.json"),
    read("docs/architecture/TINDIO_PHASE_E_PLANNED_E6_CLOSURE.md"),
    read("package.json"),
  ]);
  const matrix = JSON.parse(matrixSource);
  const rls = JSON.parse(rlsSource);
  const rollback = JSON.parse(rollbackSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(matrix.requiredFlowCount, 13);
  assert.equal(matrix.executedFlowCount, 13);
  assert.equal(matrix.passedFlowCount, 13);
  assert.equal(matrix.flows.every(({ status }) => status === "PASS"), true);
  assert.deepEqual(rls.promotedFlows, ["E-AUTH-12"]);
  assert.equal(rls.evidence.temporaryRowsRemaining, 0);
  assert.deepEqual(rollback.promotedFlows, ["E-AUTH-13"]);
  assert.equal(rollback.environment.merchantRowsWritten, 0);
  assert.match(closure, /sixth and final slice in the original Phase E plan/);
  assert.equal(packageJson.scripts["certify:phase-e:adversarial-rls"], "node scripts/phase-e-adversarial-rls-proof.mjs");
  assert.equal(packageJson.scripts["certify:phase-e:supabase-rollback"], "node scripts/phase-e-supabase-rollback-proof.mjs");
});
