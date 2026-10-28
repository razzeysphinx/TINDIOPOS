import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("H1 records the canonical target without claiming production readiness", async () => {
  const readiness = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H1_PRODUCTION_READINESS.json"));
  assert.deepEqual(readiness.canonicalTarget, {
    neonProject: "divine-sound-41148108",
    neonBranch: "br-snowy-heart-b5nf6q3n",
    database: "tindio_r6_recovery",
  });
  assert.equal(readiness.productionReadinessPassed, false);
  assert.equal(readiness.productionChangesMade, false);
  assert.equal(readiness.runtimeDefault, "supabase");
  assert.equal(readiness.decision, "NO_GO");
});

test("H1 fails closed on configuration, operators, and predecessor gates", async () => {
  const readiness = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H1_PRODUCTION_READINESS.json"));
  assert.equal(readiness.productionConfigurationGates.length, 9);
  assert.equal(readiness.productionConfigurationGates.every(({ status }) => status === "NOT_VERIFIED"), true);
  assert.equal(Object.values(readiness.operatorRoles).every((value) => value === null), true);
  assert.deepEqual(readiness.requiredPriorGateIds, ["F1-01", "F1-02", "G1-01", "G4-02", "G4-03"]);
  assert.equal(readiness.ownerApprovalRecorded, false);
});

test("H1 distinguishes the 13-flow isolated proof from production evidence", async () => {
  const [matrixSource, document, checklist, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_E_AUTH_PROOF_MATRIX.json"),
    read("docs/architecture/TINDIO_PHASE_H1_PRODUCTION_READINESS.md"),
    read("docs/architecture/TINDIO_PRODUCTION_CUTOVER_CHECKLIST.md"),
    read("package.json"),
  ]);
  const matrix = JSON.parse(matrixSource);
  const packageJson = JSON.parse(packageSource);
  assert.equal(matrix.requiredFlowCount, 13);
  assert.equal(matrix.passedFlowCount, 13);
  assert.match(document, /does not prove\s+production configuration or authorize real identities/);
  assert.match(checklist, /thirteen bounded Web\/Backend\/Data API\/Mobile\/RLS\/rollback\s+flows pass/);
  assert.equal(packageJson.scripts["test:architecture-phase-h1-production-readiness"], "node --test scripts/architecture-phase-h1-production-readiness-check.mjs");
});
