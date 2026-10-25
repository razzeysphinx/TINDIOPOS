import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Phase G closes implementation without authorizing production cutover", async () => {
  const closure = JSON.parse(
    await read("docs/architecture/TINDIO_PHASE_G_CLOSURE.json"),
  );

  assert.equal(closure.status, "IMPLEMENTATION_CLOSED_EXTERNAL_CERTIFICATION_OPEN");
  assert.equal(closure.decision, "ADVANCE_TO_PHASE_H_PLANNING_AND_REHEARSAL_ONLY");
  assert.equal(closure.runtimeDefault, "supabase");
  assert.equal(closure.productionChangesMade, false);
  assert.equal(closure.productionCutoverAllowed, false);
  assert.equal(closure.ownerApprovalRecorded, false);
  assert.deepEqual(closure.implementationSlices.map(({ slice }) => slice), ["G1", "G2", "G3", "G4"]);
});

test("Phase G closure carries every Auth and physical gate forward", async () => {
  const [closureSource, deferred] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_G_CLOSURE.json"),
    read("docs/architecture/TINDIO_DEFERRED_COMPLETION_REGISTER.md"),
  ]);
  const closure = JSON.parse(closureSource);
  const expected = ["F1-01", "F1-02", "G1-01", "G3-01", "G4-01", "G4-02", "G4-03"];

  assert.deepEqual(closure.openGateIds, expected);
  for (const gate of expected) assert.match(deferred, new RegExp(`\\| ${gate.replace("-", "\\-")} \\|`));
  for (const operation of [
    "real_user_import_or_creation",
    "production_neon_auth_enablement",
    "live_client_cutover",
    "supported_client_window_closure",
    "supabase_decommission",
  ]) assert.ok(closure.prohibitedUntilApproval.includes(operation));
});

test("Phase G source evidence remains fail closed", async () => {
  const [transitionSource, physicalSource, f4Source] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_G_MOBILE_AUTH_TRANSITION_PROOF.json"),
    read("docs/architecture/TINDIO_PHASE_G_PHYSICAL_AUTH_UPGRADE_PROOF.json"),
    read("docs/architecture/TINDIO_PHASE_F_CUTOVER_READINESS.json"),
  ]);
  const transition = JSON.parse(transitionSource);
  const physical = JSON.parse(physicalSource);
  const f4 = JSON.parse(f4Source);

  assert.equal(transition.runtimeDefault, "supabase");
  assert.equal(transition.webActivation.status, "BLOCKED_BY_F1_IDENTITY_RECONCILIATION");
  assert.equal(transition.legacySessionDeletionImplemented, false);
  assert.equal(physical.physicalCertificationPassed, false);
  assert.equal(physical.productionChangesMade, false);
  assert.equal(f4.decision, "DO_NOT_CUT_OVER");
});

test("Phase H entry is restricted to documentation and isolated rehearsal", async () => {
  const [closureSource, closureDocument, migration, certification, checklist, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_G_CLOSURE.json"),
    read("docs/architecture/TINDIO_PHASE_G_CLOSURE.md"),
    read("docs/architecture/TINDIO_MIGRATION_SEQUENCE.md"),
    read("docs/architecture/TINDIO_ARCHITECTURE_CERTIFICATION.md"),
    read("docs/architecture/TINDIO_PRODUCTION_CUTOVER_CHECKLIST.md"),
    read("package.json"),
  ]);
  const closure = JSON.parse(closureSource);
  const packageJson = JSON.parse(packageSource);

  assert.deepEqual(closure.phaseHAllowedScope, [
    "cutover_runbook_drafting",
    "rollback_runbook_drafting",
    "monitoring_and_support_plan_drafting",
    "synthetic_or_isolated_rehearsal",
    "go_no_go_evidence_template",
  ]);
  assert.match(closureDocument, /ADVANCE TO PHASE H PLANNING AND REHEARSAL ONLY/);
  assert.match(closureDocument, /Supabase remains the runtime default/);
  assert.match(migration, /Phase G5: implementation closure and Phase H entry gate/);
  assert.match(certification, /Phase G implementation closure.*PASS \(4\/4\).*PLANNING\/REHEARSAL ONLY/);
  assert.match(checklist, /production cutover remains unauthorized/);
  assert.equal(
    packageJson.scripts["test:architecture-phase-g-closure"],
    "node --test scripts/architecture-phase-g-closure-check.mjs",
  );
});
