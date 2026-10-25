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

test("J1 records query, parallelism, factory, and source-size measurements", async () => {
  const artifact = JSON.parse(await read("docs/architecture/TINDIO_PHASE_J1_PERFORMANCE_BASELINE.json"));
  assert.deepEqual(artifact.measurements, collectPerformanceBaseline());
  assert.equal(artifact.productionDatabaseInspected, false);
  assert.equal(artifact.productionTrafficGenerated, false);
  assert.equal(artifact.status, "REPOSITORY_BASELINE_RECORDED_LIVE_MEASUREMENT_DEFERRED");
});

test("J1 preserves the open production performance evidence gate", async () => {
  const deferred = await read("docs/architecture/TINDIO_DEFERRED_COMPLETION_REGISTER.md");
  assert.match(deferred, /J-01[\s\S]*NOT_STARTED/);
});
