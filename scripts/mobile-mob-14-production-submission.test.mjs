import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { REQUIRED_REAL_STORE_SCENARIOS } from "./lib/phase-24-production-evidence.mjs";
import {
  createProductionSubmissionPlan,
  executeProductionSubmission,
} from "./lib/phase-24-production-submission.mjs";

const aabSha256 = "a".repeat(64);
const lockfileSha256 = "b".repeat(64);
const sourceCommit = "c".repeat(40);
const buildId = "123e4567-e89b-42d3-a456-426614174000";
const timestamp = "2026-10-16T00:00:00.000Z";
const artifactUrl = "https://evidence.example.test/artifact";

function validInput() {
  const bound = { status: "PASS", artifactUrl, reviewer: "reviewer", reviewedAt: timestamp, aabSha256 };
  const evidence = {
    phase: 24,
    packageId: "com.tindio.pos",
    generatedAt: timestamp,
    reviewerAccess: { status: "PASS", credentialOwner: "owner", credentialVerifiedAt: timestamp, playConsoleConfiguredAt: timestamp, freshInstallVerifiedAt: timestamp },
    publicPolicyAccess: { status: "PASS", responsibleEntity: "TINDIO", privacyContact: "privacy", supportOwner: "support", effectiveDate: "2026-10-16", publicHttpsOrigin: "https://tindio.example", publicUrlsVerifiedAt: timestamp, inAppLinksVerifiedAt: timestamp, deletionRequestVerifiedAt: timestamp, playConsoleConfiguredAt: timestamp },
    signedAab: { status: "PASS", buildId, versionName: "1.0.0", versionCode: 1, sourceCommit, lockfileSha256, aabSha256, artifactUrl, reviewer: "reviewer", reviewedAt: timestamp },
    developmentDevice: { ...bound, deviceModel: "Android", osApi: 36, pageSizeBytes: 16384 },
    internalTesting: { ...bound, releaseId: "internal", testerCount: 2 },
    playAccountTestingRequirements: { status: "PASS", accountType: "ORGANIZATION", requirementApplies: false, evidenceUrl: artifactUrl, reviewer: "owner", reviewedAt: timestamp },
    closedTesting: { ...bound, releaseId: "closed", testerCount: 2, continuousDays: 2 },
    pilotMerchants: { ...bound, merchantCount: 1, storeCount: 1, registerCount: 1, minimumPilotDays: 1, ownerApprovedMinimumMerchantCount: 1, ownerApprovedMinimumStoreCount: 1, ownerApprovedMinimumRegisterCount: 1, ownerApprovedMinimumPilotDays: 1 },
    realStoreScenarios: Object.fromEntries(REQUIRED_REAL_STORE_SCENARIOS.map((name) => [name, "PASS"])),
    realStoreScenarioEvidence: Object.fromEntries(REQUIRED_REAL_STORE_SCENARIOS.map((name) => [name, { artifactUrl: `${artifactUrl}/${name}`, reviewer: "reviewer", executedAt: timestamp, aabSha256 }])),
    production: { eligible: true, releaseStatus: "APPROVED_FOR_DRAFT_SUBMISSION", ownerApprovalBy: "owner", ownerApprovedAt: timestamp, aabSha256 },
  };
  return { evidence, releaseInputs: { status: "READY" } };
}

function planFor(input, overrides = {}) {
  return createProductionSubmissionPlan({
    ...input,
    sourceCommitIsAncestor: true,
    mobileSourceMatchesBuild: true,
    lockfileSha256,
    workingTreeClean: true,
    platform: "linux",
    ...overrides,
  });
}

test("production submission is pinned to the reviewed EAS build and draft profile", () => {
  const plan = planFor(validInput());
  assert.equal(plan.allowed, true);
  assert.deepEqual(plan.command, {
    executable: "npx",
    args: ["eas-cli@latest", "submit", "--platform", "android", "--profile", "production", "--id", buildId, "--non-interactive"],
    cwd: "apps/mobile",
  });
});

test("an allowed plan starts exactly one pinned EAS submission", () => {
  const plan = planFor(validInput());
  const calls = [];
  const result = executeProductionSubmission(plan, (executable, args, options) => {
    calls.push({ executable, args, options });
    return { status: 0 };
  });
  assert.deepEqual(result, { started: true, exitCode: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.at(calls[0].args.indexOf("--id") + 1), buildId);
  assert.equal(calls[0].options.cwd, "apps/mobile");
});

test("incomplete evidence cannot start an EAS process", () => {
  const input = validInput();
  input.evidence.realStoreScenarios.offlineCashSale = "NOT_RUN";
  const plan = planFor(input);
  let calls = 0;
  const result = executeProductionSubmission(plan, () => {
    calls += 1;
    return { status: 0 };
  });
  assert.equal(plan.allowed, false);
  assert.equal(result.started, false);
  assert.equal(calls, 0);
});

test("history, mobile source, lockfile, dirty-tree, and EAS build identity mismatches fail closed", () => {
  const input = validInput();
  input.evidence.signedAab.buildId = "--latest";
  const plan = planFor(input, { sourceCommitIsAncestor: false, mobileSourceMatchesBuild: false, lockfileSha256: "e".repeat(64), workingTreeClean: false });
  assert.equal(plan.allowed, false);
  assert.ok(plan.failures.includes("Submission sourceCommit: NOT_IN_CURRENT_HISTORY"));
  assert.ok(plan.failures.includes("Submission mobile source: BUILD_SOURCE_MISMATCH"));
  assert.ok(plan.failures.includes("Submission lockfileSha256: WORKTREE_LOCKFILE_MISMATCH"));
  assert.ok(plan.failures.includes("Submission worktree: NOT_CLEAN"));
  assert.ok(plan.failures.includes("Submission buildId: INVALID_EAS_BUILD_ID"));
});

test("the public production command has no direct EAS bypass", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(packageJson.scripts["mobile:submit:android:production-draft"], "node scripts/phase-24-production-submit.mjs");
  assert.doesNotMatch(packageJson.scripts["mobile:submit:android:production-draft"], /eas-cli|eas submit/u);
});
