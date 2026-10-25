export const rollbackReadinessRequirements = Object.freeze([
  "rollbackAuthorityNamed",
  "supabaseProviderAvailable",
  "webSelectorProcedureVerified",
  "backendSelectorProcedureVerified",
  "supportedMobileFallbackVerified",
  "legacySessionRetentionVerified",
  "clientCompatibilityWindowOpen",
  "backupRestorePointVerified",
  "monitoringAndSupportReady",
  "financialAndCustodyReconciliationReady",
]);

export const rollbackOutcomeRequirements = Object.freeze([
  "newNeonTrafficStopped",
  "supabaseWebAccessRestored",
  "supabaseBackendAccessRestored",
  "supportedMobileAccessRestored",
  "neonSessionsPreservedForForensics",
  "deviceEnrollmentPreserved",
  "offlineAuthorizationPreserved",
  "sqliteAndOutboxCustodyPreserved",
  "duplicateFinancialEffectsZero",
  "crossTenantAccessZero",
  "identityAndFinancialReconciliationPassed",
  "incidentPromotionHoldActive",
]);

function missing(requirements, evidence) {
  return requirements.filter((key) => evidence?.[key] !== true);
}

export function evaluateRollbackReadiness(evidence) {
  const missingRequirements = missing(rollbackReadinessRequirements, evidence);
  return {
    ready: missingRequirements.length === 0,
    decision: missingRequirements.length === 0
      ? "READY_FOR_AUTHORIZED_REHEARSAL"
      : "NOT_READY",
    missingRequirements,
  };
}

export function evaluateRollbackOutcome(evidence) {
  const missingRequirements = missing(rollbackOutcomeRequirements, evidence);
  return {
    passed: missingRequirements.length === 0,
    decision: missingRequirements.length === 0
      ? "ROLLBACK_REHEARSAL_PASS"
      : "ROLLBACK_INCOMPLETE_HOLD",
    missingRequirements,
  };
}
