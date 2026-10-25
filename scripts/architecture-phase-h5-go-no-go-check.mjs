import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateProductionCutover,
  productionCutoverRequirements,
} from "./phase-h-go-no-go-evaluator.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const all = () => Object.fromEntries(productionCutoverRequirements.map((key) => [key, true]));

test("H5 evaluator rejects absent, partial, and non-boolean evidence", () => {
  const absent = evaluateProductionCutover();
  assert.equal(absent.decision, "NO_GO");
  assert.deepEqual(absent.missingRequirements, [...productionCutoverRequirements]);

  const partial = all();
  partial.explicitOwnerApprovalRecorded = "approved";
  partial.mobileSignedBuildCampaignPassed = false;
  const result = evaluateProductionCutover(partial);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.missingRequirements, ["mobileSignedBuildCampaignPassed", "explicitOwnerApprovalRecorded"]);
});

test("H5 complete synthetic evidence can produce GO but never authorizes retirement", () => {
  assert.deepEqual(evaluateProductionCutover(all()), {
    allowed: true,
    decision: "GO",
    missingRequirements: [],
    phaseIRetirementAllowed: false,
  });
});

test("H5 repository decision remains NO GO with unsigned approval", async () => {
  const decision = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H5_GO_NO_GO.json"));
  assert.equal(decision.status, "PHASE_H_REPOSITORY_PACKAGE_COMPLETE_PRODUCTION_EXECUTION_BLOCKED");
  assert.equal(decision.decision, "NO_GO");
  assert.equal(decision.productionCutoverAllowed, false);
  assert.equal(decision.liveAuthenticatedTrafficObserved, false);
  assert.equal(decision.productionRollbackRehearsalPassed, false);
  assert.equal(decision.ownerApprovalRecorded, false);
  assert.equal(decision.phaseIRetirementAllowed, false);
  assert.equal(Object.values(decision.approvalRecord).every((value) => value === null), true);
  assert.deepEqual(decision.blockingRequirements, [...productionCutoverRequirements]);
});

test("H5 consolidates all five slices and retains the deferred gates", async () => {
  const [decisionSource, h1Source, h2Source, h3Source, h4Source, document, deferred, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_H5_GO_NO_GO.json"),
    read("docs/architecture/TINDIO_PHASE_H1_PRODUCTION_READINESS.json"),
    read("docs/architecture/TINDIO_PHASE_H2_AUTH_TRAFFIC_CANARY.json"),
    read("docs/architecture/TINDIO_PHASE_H3_MONITORING_SUPPORT.json"),
    read("docs/architecture/TINDIO_PHASE_H4_ROLLBACK_REHEARSAL.json"),
    read("docs/architecture/TINDIO_PHASE_H5_GO_NO_GO.md"),
    read("docs/architecture/TINDIO_DEFERRED_COMPLETION_REGISTER.md"),
    read("package.json"),
  ]);
  const sources = [h1Source, h2Source, h3Source, h4Source].map(JSON.parse);
  const decision = JSON.parse(decisionSource);
  assert.equal(sources.every(({ productionChangesMade }) => productionChangesMade === false), true);
  assert.deepEqual(decision.sliceStatus.map(({ slice }) => slice), ["H1", "H2", "H3", "H4", "H5"]);
  assert.match(document, /This repository work cannot self-approve a\s+production change/);
  for (const id of ["H-01", "H-02", "H-03"]) assert.match(deferred, new RegExp(`\\| ${id.replace("-", "\\-")} \\|`));
  const scripts = JSON.parse(packageSource).scripts;
  assert.equal(scripts["test:architecture-phase-h5-go-no-go"], "node --test scripts/architecture-phase-h5-go-no-go-check.mjs");
  assert.match(scripts["test:architecture-phase-h"], /phase-h1[\s\S]*phase-h2[\s\S]*phase-h3[\s\S]*phase-h4[\s\S]*phase-h5/);
});
