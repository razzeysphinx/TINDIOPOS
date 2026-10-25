import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("J4 workflow isolates all supported workspace jobs", async () => {
  const [workflow, decision] = await Promise.all([
    read(".github/workflows/tindio-independent-ci.yml"),
    read("docs/architecture/TINDIO_PHASE_J4_INDEPENDENT_CI.json").then(JSON.parse)
  ]);
  for (const job of decision.independentJobs) assert.match(workflow, new RegExp(`^  ${job}:`, "m"));
  for (const command of ["contracts:typecheck", "web:typecheck", "backend:typecheck", "backend:test", "mobile:typecheck", "test:repository-structure", "test:architecture-phase-j"]) {
    assert.equal(workflow.includes(command), true, command);
  }
});

test("J4 workflow is read-only and bounded", async () => {
  const workflow = await read(".github/workflows/tindio-independent-ci.yml");
  assert.match(workflow, /permissions:\s*\n  contents: read/);
  assert.equal((workflow.match(/timeout-minutes:/g) ?? []).length, 5);
  assert.doesNotMatch(workflow, /secrets\.|deploy|environment:/i);
});

test("J4 preserves the authoritative baseline workflow", async () => {
  const [baseline, decision] = await Promise.all([
    read(".github/workflows/tindio-baseline-certification.yml"),
    read("docs/architecture/TINDIO_PHASE_J4_INDEPENDENT_CI.json").then(JSON.parse)
  ]);
  assert.match(baseline, /Run authoritative TINDIO certification/);
  assert.equal(decision.baselineCertificationReplaced, false);
  assert.equal(decision.productionDeploymentIncluded, false);
});
