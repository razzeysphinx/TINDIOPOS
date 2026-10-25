export const productionCutoverRequirements = Object.freeze([
  "phaseFAndGExternalGatesClosed",
  "productionAuthConfigurationVerified",
  "allOperatorRolesNamed",
  "identityMappingReviewedAndApproved",
  "passwordClaimPolicyApproved",
  "webProductionLifecyclePassed",
  "mobileSignedBuildCampaignPassed",
  "supportedClientPolicyApproved",
  "monitoringThresholdsAndSupportApproved",
  "backupAndRestorePointVerified",
  "productionLikeRollbackRehearsalPassed",
  "cutoverWindowApproved",
  "explicitOwnerApprovalRecorded",
]);

export function evaluateProductionCutover(evidence) {
  const missingRequirements = productionCutoverRequirements.filter(
    (key) => evidence?.[key] !== true,
  );
  return {
    allowed: missingRequirements.length === 0,
    decision: missingRequirements.length === 0 ? "GO" : "NO_GO",
    missingRequirements,
    phaseIRetirementAllowed: false,
  };
}
