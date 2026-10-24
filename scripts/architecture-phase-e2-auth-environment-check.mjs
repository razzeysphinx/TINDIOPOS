import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");
const evidence = JSON.parse(await read("docs/architecture/TINDIO_PHASE_E2_NEON_AUTH_ENVIRONMENT.json"));
const matrix = JSON.parse(await read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"));

test("E2 records a dedicated expiring non-production environment", () => {
  assert.equal(evidence.phase, "E");
  assert.equal(evidence.slice, "E2");
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.strategy, "DEDICATED_EMPTY_PROJECT_WITH_EXPIRING_CHILD_BRANCH");
  assert.equal(evidence.sourceDataCopied, false);
  assert.equal(evidence.project.temporary, true);
  assert.equal(evidence.branch.default, false);
  assert.equal(evidence.branch.protected, false);
  assert.match(evidence.branch.expiresAt, /^2026-10-31T04:30:00Z$/);
});

test("E2 is synthetic-only and contains no business identities", () => {
  assert.equal(evidence.auth.syntheticEmailDomain, "auth-proof.tindio.invalid");
  assert.equal(evidence.auth.syntheticUserCount, 1);
  assert.equal(evidence.auth.otherUserCount, 0);
  assert.equal(evidence.auth.realUsersImported, 0);
  assert.equal(evidence.auth.passwordsImported, 0);
  assert.equal(evidence.businessData.organizationRows, 0);
  assert.equal(evidence.businessData.profileRows, 0);
  assert.equal(evidence.businessData.merchantDataImported, false);
});

test("E2 installs the complete canonical schema behind Neon identity helpers", () => {
  assert.equal(evidence.canonicalInstall.migrationCount, 18);
  assert.equal(evidence.canonicalInstall.publicTables, 101);
  assert.equal(evidence.canonicalInstall.privateTables, 10);
  assert.equal(evidence.canonicalInstall.publicFunctions, 214);
  assert.equal(evidence.canonicalInstall.publicPolicies, 149);
  assert.equal(evidence.canonicalInstall.unvalidatedForeignKeys, 0);
  assert.equal(evidence.canonicalInstall.permissionReferenceRows, 65);
  assert.equal(evidence.canonicalInstall.providerRoleMappings, 3);
  assert.equal(evidence.canonicalInstall.authUserIdPresent, true);
  assert.equal(evidence.canonicalInstall.authJwtPresent, true);
  assert.equal(evidence.canonicalInstall.identityAdapterPresent, true);
  assert.equal(evidence.canonicalInstall.latestMigrationPresent, true);
});

test("E2 provisions Auth and Data API without changing application origins", () => {
  assert.equal(evidence.auth.provider, "better_auth");
  assert.equal(evidence.auth.localhostAllowed, true);
  assert.equal(evidence.dataApi.status, "active");
  assert.match(evidence.dataApi.schemaRefreshedAt, /^2026-10-24T04:58:51Z$/);
  assert.equal(evidence.dataApi.authProvider, "neon_auth");
  assert.equal(evidence.dataApi.defaultGrantsAdded, false);
  assert.deepEqual(evidence.dataApi.exposedSchemas, ["public"]);
  assert.deepEqual(evidence.applicationImpact, {
    webOriginChanged: false,
    mobileOriginChanged: false,
    backendOriginChanged: false,
    deploymentChanged: false,
    localEnvChanged: false,
    neonContextChanged: false,
    supabaseAuthRemainsActive: true,
  });
});

test("E2 does not promote any runtime proof flow", () => {
  assert.equal(matrix.requiredFlowCount, 13);
  assert.equal(matrix.flows.length, 13);
  assert.ok(matrix.flows.every((flow) => flow.status === "NOT_RUN"));
  assert.equal(evidence.proof.requiredFlowCount, 13);
  assert.equal(evidence.proof.flowsExecuted, 0);
  assert.equal(evidence.proof.allFlowsRemainNotRun, true);
});

test("E2 documentation preserves production and cleanup stop points", async () => {
  const [handoff, migration, certification, cutover, neonConfig, neonContext, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_E2_NEON_AUTH_ENVIRONMENT.md"),
    read("docs/architecture/TINDIO_MIGRATION_SEQUENCE.md"),
    read("docs/architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md"),
    read("docs/architecture/TINDIO_PRODUCTION_CUTOVER_CHECKLIST.md"),
    read("neon.ts"),
    read(".neon"),
    read("package.json"),
  ]);
  assert.match(handoff, /manual project deletion is required/i);
  assert.match(handoff, /every flow remains `NOT_RUN`/);
  assert.match(migration, /Completed Slice E2: isolated environment provisioning/);
  assert.match(certification, /E2 used the owner's dedicated-project fallback approval/);
  assert.match(cutover, /Disposable Neon branch and synthetic Auth environment approved/);
  assert.match(neonConfig, /authProvider:\s*["']external["']/);
  assert.match(neonConfig, /supabaseJwksUrl/);
  assert.match(neonContext, /divine-sound-41148108/);
  assert.match(packageSource, /test:architecture-phase-e2-auth-environment/);
  assert.doesNotMatch(JSON.stringify(evidence), /secret_server_key|database_url/i);
});
