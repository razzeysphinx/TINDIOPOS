import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateRollbackOutcome,
  evaluateRollbackReadiness,
  rollbackOutcomeRequirements,
  rollbackReadinessRequirements,
} from "./phase-h-rollback-evaluator.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const all = (requirements) => Object.fromEntries(requirements.map((key) => [key, true]));

test("H4 readiness evaluator fails closed on absent or partial evidence", () => {
  const absent = evaluateRollbackReadiness();
  assert.equal(absent.ready, false);
  assert.deepEqual(absent.missingRequirements, [...rollbackReadinessRequirements]);

  const partialEvidence = all(rollbackReadinessRequirements);
  partialEvidence.rollbackAuthorityNamed = false;
  partialEvidence.legacySessionRetentionVerified = "yes";
  const partial = evaluateRollbackReadiness(partialEvidence);
  assert.equal(partial.decision, "NOT_READY");
  assert.deepEqual(partial.missingRequirements, ["rollbackAuthorityNamed", "legacySessionRetentionVerified"]);
});

test("H4 synthetic complete evidence passes without executing a provider change", () => {
  assert.deepEqual(evaluateRollbackReadiness(all(rollbackReadinessRequirements)), {
    ready: true,
    decision: "READY_FOR_AUTHORIZED_REHEARSAL",
    missingRequirements: [],
  });
  assert.deepEqual(evaluateRollbackOutcome(all(rollbackOutcomeRequirements)), {
    passed: true,
    decision: "ROLLBACK_REHEARSAL_PASS",
    missingRequirements: [],
  });
});

test("H4 requires custody, finance, tenant, and incident hold in the outcome", () => {
  const evidence = all(rollbackOutcomeRequirements);
  delete evidence.sqliteAndOutboxCustodyPreserved;
  delete evidence.duplicateFinancialEffectsZero;
  delete evidence.crossTenantAccessZero;
  delete evidence.incidentPromotionHoldActive;
  const outcome = evaluateRollbackOutcome(evidence);
  assert.equal(outcome.passed, false);
  assert.deepEqual(outcome.missingRequirements, [
    "sqliteAndOutboxCustodyPreserved",
    "duplicateFinancialEffectsZero",
    "crossTenantAccessZero",
    "incidentPromotionHoldActive",
  ]);
});

test("H4 retains isolated proof while production rehearsal stays blocked", async () => {
  const [planSource, isolatedSource, document, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_H4_ROLLBACK_REHEARSAL.json"),
    read("docs/architecture/TINDIO_PHASE_E_PLANNED_E6_SUPABASE_ROLLBACK_PROOF.json"),
    read("docs/architecture/TINDIO_PHASE_H4_ROLLBACK_REHEARSAL.md"),
    read("package.json"),
  ]);
  const plan = JSON.parse(planSource);
  const isolated = JSON.parse(isolatedSource);
  assert.equal(isolated.status, "PASS");
  assert.equal(isolated.environment.supabaseRemainsDefault, true);
  assert.equal(plan.productionRollbackRehearsal.status, "NOT_RUN");
  assert.equal(plan.productionRehearsalPassed, false);
  assert.equal(plan.productionChangesMade, false);
  assert.equal(plan.decision, "NO_GO");
  assert.match(document, /Rollback is a traffic and selector decision, never a data-deletion operation/);
  assert.equal(JSON.parse(packageSource).scripts["test:architecture-phase-h4-rollback-rehearsal"], "node --test scripts/architecture-phase-h4-rollback-rehearsal-check.mjs");
});
