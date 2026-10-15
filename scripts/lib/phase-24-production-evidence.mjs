export const REQUIRED_REAL_STORE_SCENARIOS = [
  "loginAndBusinessContext",
  "deviceEnrollment",
  "storeRegisterAssignment",
  "initialSync",
  "onlineCashSale",
  "offlineCashSale",
  "appKillRecovery",
  "phoneRestartRecovery",
  "networkLossBeforeCommit",
  "networkLossAfterCommit",
  "missingAckReplay",
  "reconnectExactlyOnce",
  "cameraBarcode",
  "hidBarcode",
  "tenantIsolation",
  "storeIsolation",
  "revokedDevice",
  "closedShift",
  "upgradeWithUnsyncedEvent",
  "noDuplicateMoney",
  "noDuplicateInventoryMovement",
];

const SHA256 = /^[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const HTTPS = /^https:\/\//u;

function populated(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

export function evaluatePhase24ProductionEvidence(evidence, releaseInputs) {
  const failures = [];
  const fail = (message) => failures.push(message);
  const requirePass = (label, value) => {
    if (value !== "PASS") fail(`${label}: ${value ?? "MISSING"}`);
  };
  const requireText = (label, value) => {
    if (!populated(value)) fail(`${label}: MISSING`);
  };
  const requireHttps = (label, value) => {
    if (!populated(value) || !HTTPS.test(value)) fail(`${label}: INVALID_OR_MISSING`);
  };
  const requirePositiveInteger = (label, value) => {
    if (!positiveInteger(value)) fail(`${label}: INVALID_OR_MISSING`);
  };

  if (releaseInputs?.status !== "READY") {
    fail(`MOB-13 production release inputs: ${releaseInputs?.status ?? "MISSING"}`);
  }
  if (evidence?.phase !== 24) fail("Evidence phase: INVALID_OR_MISSING");
  if (evidence?.packageId !== "com.tindio.pos") fail("Package identity: INVALID_OR_MISSING");
  requireText("Evidence generatedAt", evidence?.generatedAt);

  const build = evidence?.signedAab;
  requirePass("Signed AAB", build?.status);
  requireText("Signed AAB buildId", build?.buildId);
  requireText("Signed AAB versionName", build?.versionName);
  requirePositiveInteger("Signed AAB versionCode", build?.versionCode);
  if (!COMMIT.test(build?.sourceCommit ?? "")) fail("Signed AAB sourceCommit: INVALID_OR_MISSING");
  if (!SHA256.test(build?.lockfileSha256 ?? "")) fail("Signed AAB lockfileSha256: INVALID_OR_MISSING");
  if (!SHA256.test(build?.aabSha256 ?? "")) fail("Signed AAB aabSha256: INVALID_OR_MISSING");
  requireHttps("Signed AAB artifactUrl", build?.artifactUrl);
  requireText("Signed AAB reviewer", build?.reviewer);
  requireText("Signed AAB reviewedAt", build?.reviewedAt);

  const requireBoundArtifact = (label, record) => {
    requirePass(label, record?.status);
    requireHttps(`${label} artifactUrl`, record?.artifactUrl);
    requireText(`${label} reviewer`, record?.reviewer);
    requireText(`${label} reviewedAt`, record?.reviewedAt);
    if (record?.aabSha256 !== build?.aabSha256) fail(`${label} aabSha256: BUILD_MISMATCH`);
  };

  const reviewer = evidence?.reviewerAccess;
  requirePass("Google Play reviewer access", reviewer?.status);
  for (const key of ["credentialOwner", "credentialVerifiedAt", "playConsoleConfiguredAt", "freshInstallVerifiedAt"]) {
    requireText(`Google Play reviewer access ${key}`, reviewer?.[key]);
  }

  const policy = evidence?.publicPolicyAccess;
  requirePass("Public privacy/support/deletion access", policy?.status);
  for (const key of ["responsibleEntity", "privacyContact", "supportOwner", "effectiveDate", "publicUrlsVerifiedAt", "inAppLinksVerifiedAt", "deletionRequestVerifiedAt", "playConsoleConfiguredAt"]) {
    requireText(`Public policy ${key}`, policy?.[key]);
  }
  requireHttps("Public policy publicHttpsOrigin", policy?.publicHttpsOrigin);

  requireBoundArtifact("Development device", evidence?.developmentDevice);
  requireText("Development device model", evidence?.developmentDevice?.deviceModel);
  requirePositiveInteger("Development device OS API", evidence?.developmentDevice?.osApi);
  requirePositiveInteger("Development device page size", evidence?.developmentDevice?.pageSizeBytes);

  requireBoundArtifact("Internal testing", evidence?.internalTesting);
  requireText("Internal testing releaseId", evidence?.internalTesting?.releaseId);
  requirePositiveInteger("Internal testing testerCount", evidence?.internalTesting?.testerCount);

  const account = evidence?.playAccountTestingRequirements;
  requirePass("Play account testing requirements", account?.status);
  requireText("Play account type", account?.accountType);
  if (typeof account?.requirementApplies !== "boolean") {
    fail("Play account requirementApplies: INVALID_OR_MISSING");
  }
  requireHttps("Play account requirement evidenceUrl", account?.evidenceUrl);
  requireText("Play account requirement reviewer", account?.reviewer);
  requireText("Play account requirement reviewedAt", account?.reviewedAt);
  if (account?.requirementApplies === true) {
    requirePositiveInteger("Play account minimumTesterCount", account?.minimumTesterCount);
    requirePositiveInteger("Play account minimumContinuousDays", account?.minimumContinuousDays);
  }

  requireBoundArtifact("Closed testing", evidence?.closedTesting);
  requireText("Closed testing releaseId", evidence?.closedTesting?.releaseId);
  requirePositiveInteger("Closed testing testerCount", evidence?.closedTesting?.testerCount);
  requirePositiveInteger("Closed testing continuousDays", evidence?.closedTesting?.continuousDays);
  if (account?.requirementApplies === true) {
    if (evidence?.closedTesting?.testerCount < account?.minimumTesterCount) fail("Closed testing testerCount: BELOW_ACCOUNT_REQUIREMENT");
    if (evidence?.closedTesting?.continuousDays < account?.minimumContinuousDays) fail("Closed testing continuousDays: BELOW_ACCOUNT_REQUIREMENT");
  }

  const pilot = evidence?.pilotMerchants;
  requireBoundArtifact("Pilot merchants", pilot);
  for (const key of ["merchantCount", "storeCount", "registerCount", "minimumPilotDays", "ownerApprovedMinimumMerchantCount", "ownerApprovedMinimumStoreCount", "ownerApprovedMinimumRegisterCount", "ownerApprovedMinimumPilotDays"]) {
    requirePositiveInteger(`Pilot merchants ${key}`, pilot?.[key]);
  }
  for (const [actual, minimum] of [
    ["merchantCount", "ownerApprovedMinimumMerchantCount"],
    ["storeCount", "ownerApprovedMinimumStoreCount"],
    ["registerCount", "ownerApprovedMinimumRegisterCount"],
    ["minimumPilotDays", "ownerApprovedMinimumPilotDays"],
  ]) {
    if (positiveInteger(pilot?.[minimum]) && pilot?.[actual] < pilot?.[minimum]) fail(`Pilot merchants ${actual}: BELOW_OWNER_APPROVED_MINIMUM`);
  }

  for (const name of REQUIRED_REAL_STORE_SCENARIOS) {
    requirePass(`Scenario ${name}`, evidence?.realStoreScenarios?.[name]);
    const record = evidence?.realStoreScenarioEvidence?.[name];
    requireHttps(`Scenario ${name} artifactUrl`, record?.artifactUrl);
    requireText(`Scenario ${name} reviewer`, record?.reviewer);
    requireText(`Scenario ${name} executedAt`, record?.executedAt);
    if (record?.aabSha256 !== build?.aabSha256) fail(`Scenario ${name} aabSha256: BUILD_MISMATCH`);
  }

  if (evidence?.production?.eligible !== true) fail("Production eligibility: NOT_APPROVED");
  if (evidence?.production?.releaseStatus !== "APPROVED_FOR_DRAFT_SUBMISSION") fail("Production releaseStatus: NOT_APPROVED_FOR_DRAFT_SUBMISSION");
  requireText("Production ownerApprovalBy", evidence?.production?.ownerApprovalBy);
  requireText("Production ownerApprovedAt", evidence?.production?.ownerApprovedAt);
  if (evidence?.production?.aabSha256 !== build?.aabSha256) fail("Production aabSha256: BUILD_MISMATCH");

  return { passed: failures.length === 0, failures };
}
