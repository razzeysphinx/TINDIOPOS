export const retirementRequirements = Object.freeze([
  "accountsMigratedAndAccounted",
  "activeWebUsesReplacementAuth",
  "activeBackendUsesReplacementAuth",
  "activeMobileReleaseUsesReplacementAuth",
  "noSupportedClientUsesSupabaseTokens",
  "approvedAuthFlowsPassed",
  "tenantIsolationPassed",
  "financialReplayPassed",
  "noCustodyDependsOnSupabaseAuth",
  "backupsAndRollbackVerified",
  "monitoringObservationWindowPassed",
  "explicitOwnerDecommissionApproval"
]);

export function evaluateSupabaseRetirement(evidence = {}) {
  const missingRequirements = retirementRequirements.filter((key) => evidence[key] !== true);
  return Object.freeze({
    allowed: missingRequirements.length === 0,
    decision: missingRequirements.length === 0 ? "ELIGIBLE_FOR_SEPARATE_DECOMMISSION_APPROVAL" : "DO_NOT_RETIRE",
    missingRequirements
  });
}
