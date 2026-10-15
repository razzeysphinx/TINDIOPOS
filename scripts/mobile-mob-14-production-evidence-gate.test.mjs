import assert from "node:assert/strict";
import test from "node:test";
import {
  REQUIRED_REAL_STORE_SCENARIOS,
  evaluatePhase24ProductionEvidence,
} from "./lib/phase-24-production-evidence.mjs";

const hash = "a".repeat(64);
const timestamp = "2026-10-16T00:00:00.000Z";
const artifactUrl = "https://evidence.example.test/artifact";

function validFixture() {
  const bound = { status: "PASS", artifactUrl, reviewer: "release-reviewer", reviewedAt: timestamp, aabSha256: hash };
  return {
    releaseInputs: { status: "READY" },
    evidence: {
      phase: 24,
      packageId: "com.tindio.pos",
      generatedAt: timestamp,
      reviewerAccess: { status: "PASS", credentialOwner: "security-owner", credentialVerifiedAt: timestamp, playConsoleConfiguredAt: timestamp, freshInstallVerifiedAt: timestamp },
      publicPolicyAccess: { status: "PASS", responsibleEntity: "TINDIO", privacyContact: "privacy owner", supportOwner: "support owner", effectiveDate: "2026-10-16", publicHttpsOrigin: "https://tindio.example", publicUrlsVerifiedAt: timestamp, inAppLinksVerifiedAt: timestamp, deletionRequestVerifiedAt: timestamp, playConsoleConfiguredAt: timestamp },
      signedAab: { status: "PASS", buildId: "build-1", versionName: "1.0.0", versionCode: 1, sourceCommit: "b".repeat(40), lockfileSha256: "c".repeat(64), aabSha256: hash, artifactUrl, reviewer: "release-reviewer", reviewedAt: timestamp },
      developmentDevice: { ...bound, deviceModel: "Test Android", osApi: 36, pageSizeBytes: 16384 },
      internalTesting: { ...bound, releaseId: "internal-1", testerCount: 2 },
      playAccountTestingRequirements: { status: "PASS", accountType: "PERSONAL", requirementApplies: true, minimumTesterCount: 12, minimumContinuousDays: 14, evidenceUrl: artifactUrl, reviewer: "play-owner", reviewedAt: timestamp },
      closedTesting: { ...bound, releaseId: "closed-1", testerCount: 12, continuousDays: 14 },
      pilotMerchants: { ...bound, merchantCount: 2, storeCount: 2, registerCount: 3, minimumPilotDays: 7, ownerApprovedMinimumMerchantCount: 2, ownerApprovedMinimumStoreCount: 2, ownerApprovedMinimumRegisterCount: 2, ownerApprovedMinimumPilotDays: 7 },
      realStoreScenarios: Object.fromEntries(REQUIRED_REAL_STORE_SCENARIOS.map((name) => [name, "PASS"])),
      realStoreScenarioEvidence: Object.fromEntries(REQUIRED_REAL_STORE_SCENARIOS.map((name) => [name, { artifactUrl: `${artifactUrl}/${name}`, reviewer: "scenario-reviewer", executedAt: timestamp, aabSha256: hash }])),
      production: { eligible: true, releaseStatus: "APPROVED_FOR_DRAFT_SUBMISSION", ownerApprovalBy: "product-owner", ownerApprovedAt: timestamp, aabSha256: hash },
    },
  };
}

test("complete evidence bound to one signed artifact passes", () => {
  const fixture = validFixture();
  assert.deepEqual(evaluatePhase24ProductionEvidence(fixture.evidence, fixture.releaseInputs), { passed: true, failures: [] });
});

test("a missing required scenario fails closed", () => {
  const fixture = validFixture();
  delete fixture.evidence.realStoreScenarios.noDuplicateMoney;
  const result = evaluatePhase24ProductionEvidence(fixture.evidence, fixture.releaseInputs);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes("Scenario noDuplicateMoney: MISSING"));
});

test("scenario evidence for a different AAB cannot authorize release", () => {
  const fixture = validFixture();
  fixture.evidence.realStoreScenarioEvidence.offlineCashSale.aabSha256 = "d".repeat(64);
  const result = evaluatePhase24ProductionEvidence(fixture.evidence, fixture.releaseInputs);
  assert.ok(result.failures.includes("Scenario offlineCashSale aabSha256: BUILD_MISMATCH"));
});

test("account-specific closed-test thresholds are enforced", () => {
  const fixture = validFixture();
  fixture.evidence.closedTesting.testerCount = 11;
  fixture.evidence.closedTesting.continuousDays = 13;
  const result = evaluatePhase24ProductionEvidence(fixture.evidence, fixture.releaseInputs);
  assert.ok(result.failures.includes("Closed testing testerCount: BELOW_ACCOUNT_REQUIREMENT"));
  assert.ok(result.failures.includes("Closed testing continuousDays: BELOW_ACCOUNT_REQUIREMENT"));
});

test("missing build identity, artifact links, and owner approval fail closed", () => {
  const fixture = validFixture();
  fixture.evidence.signedAab.aabSha256 = null;
  fixture.evidence.internalTesting.artifactUrl = null;
  fixture.evidence.production.eligible = false;
  const result = evaluatePhase24ProductionEvidence(fixture.evidence, fixture.releaseInputs);
  assert.equal(result.passed, false);
  assert.ok(result.failures.includes("Signed AAB aabSha256: INVALID_OR_MISSING"));
  assert.ok(result.failures.includes("Internal testing artifactUrl: INVALID_OR_MISSING"));
  assert.ok(result.failures.includes("Production eligibility: NOT_APPROVED"));
});

test("owner-approved pilot minimums are enforced", () => {
  const fixture = validFixture();
  fixture.evidence.pilotMerchants.storeCount = 1;
  const result = evaluatePhase24ProductionEvidence(fixture.evidence, fixture.releaseInputs);
  assert.ok(result.failures.includes("Pilot merchants storeCount: BELOW_OWNER_APPROVED_MINIMUM"));
});
