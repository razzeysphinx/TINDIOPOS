import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { collectPerformanceBaseline } from "./phase-j-performance-baseline.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("J1 baseline is reproducible from tracked source", () => {
  const first = collectPerformanceBaseline();
  const second = collectPerformanceBaseline();
  assert.deepEqual(first, second);
  for (const value of Object.values(first)) assert.equal(Number.isInteger(value) && value > 0, true);
});

test("J1 baseline remains a valid lower-risk reference after later slices", async () => {
  const artifact = JSON.parse(await read("docs/architecture/TINDIO_PHASE_J1_PERFORMANCE_BASELINE.json"));
  const current = collectPerformanceBaseline();
  assert.equal(current.databaseQueryCallsites <= artifact.measurements.databaseQueryCallsites, true);
  assert.equal(current.runtimeClientFactories <= artifact.measurements.runtimeClientFactories, true);
  assert.equal(current.explicitParallelGroups >= artifact.measurements.explicitParallelGroups, true);
  assert.equal(current.runtimeSourceFiles, artifact.measurements.runtimeSourceFiles);
  assert.equal(artifact.productionDatabaseInspected, false);
  assert.equal(artifact.productionTrafficGenerated, false);
  assert.equal(artifact.status, "REPOSITORY_BASELINE_RECORDED_LIVE_MEASUREMENT_DEFERRED");
});

test("J1 preserves the open production performance evidence gate", async () => {
  const deferred = await read("docs/architecture/TINDIO_DEFERRED_COMPLETION_REGISTER.md");
  assert.match(deferred, /J-01[\s\S]*REPOSITORY_PACKAGE_COMPLETE_EXTERNAL_EVIDENCE_OPEN/);
});
