export const repositoryRequirements = Object.freeze([
  "workspaceTypechecksPassed",
  "backendTestsPassed",
  "mobileLintHasNoErrors",
  "rootLintHasNoErrors",
  "webProductionBuildPassed",
  "repositoryStructurePassed",
  "phaseJChecksPassed"
]);

export const releaseRequirements = Object.freeze([
  "exactReleaseCandidateIdentified",
  "independentCiPassedOnExactCommit",
  "browserEndToEndPassed",
  "migrationAndRestoreRehearsalPassed",
  "productionPerformanceSecurityAccessibilityPassed",
  "physicalMobileCampaignPassed",
  "phaseHProductionCutoverClosed",
  "phaseIProviderRetirementDecisionClosed",
  "explicitOwnerReleaseApproval"
]);

export function evaluateReleaseReadiness({ repository = {}, release = {} } = {}) {
  const missingRepository = repositoryRequirements.filter((key) => repository[key] !== true);
  const missingRelease = releaseRequirements.filter((key) => release[key] !== true);
  const repositoryReady = missingRepository.length === 0;
  const releaseReady = repositoryReady && missingRelease.length === 0;
  return Object.freeze({
    repositoryReady,
    releaseReady,
    decision: releaseReady ? "READY_FOR_SEPARATE_RELEASE_APPROVAL" : "RELEASE_NO_GO",
    missingRepository,
    missingRelease
  });
}
