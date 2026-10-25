import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateReleaseReadiness, releaseRequirements, repositoryRequirements } from "./phase-j-release-readiness-evaluator.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const all = (requirements) => Object.fromEntries(requirements.map((key) => [key, true]));

test("J5 evaluator distinguishes repository readiness from release readiness", () => {
  const repository = all(repositoryRequirements);
  const blocked = evaluateReleaseReadiness({ repository });
  assert.equal(blocked.repositoryReady, true);
  assert.equal(blocked.releaseReady, false);
  assert.deepEqual(blocked.missingRelease, [...releaseRequirements]);
});

test("J5 synthetic complete evidence creates eligibility but does not deploy", () => {
  const result = evaluateReleaseReadiness({ repository: all(repositoryRequirements), release: all(releaseRequirements) });
  assert.equal(result.releaseReady, true);
  assert.equal(result.decision, "READY_FOR_SEPARATE_RELEASE_APPROVAL");
});

test("J5 repository decision is complete, non-production, and fail closed", async () => {
  const decision = JSON.parse(await read("docs/architecture/TINDIO_PHASE_J5_RELEASE_READINESS.json"));
  assert.equal(Object.values(decision.repositoryEvidence).every(Boolean), true);
  assert.equal(Object.values(decision.releaseEvidence).every((value) => value === false), true);
  assert.equal(decision.repositoryReady, true);
  assert.equal(decision.releaseReady, false);
  assert.equal(decision.decision, "RELEASE_NO_GO");
  assert.equal(decision.productionChangesMade, false);
});

test("J5 closure preserves Phase H, I, and deferred J gates", async () => {
  const [h5, i5, deferred] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_H5_GO_NO_GO.json").then(JSON.parse),
    read("docs/architecture/TINDIO_PHASE_I5_DECOMMISSION_DECISION.json").then(JSON.parse),
    read("docs/architecture/TINDIO_DEFERRED_COMPLETION_REGISTER.md")
  ]);
  assert.equal(h5.decision, "NO_GO");
  assert.equal(i5.decision, "DO_NOT_DECOMMISSION");
  assert.match(deferred, /J-01[\s\S]*REPOSITORY_PACKAGE_COMPLETE_EXTERNAL_EVIDENCE_OPEN/);
});
