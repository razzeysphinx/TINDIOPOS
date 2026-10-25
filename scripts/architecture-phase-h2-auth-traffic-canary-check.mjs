import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("H2 canary stages increase monotonically and cannot skip observation", async () => {
  const canary = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H2_AUTH_TRAFFIC_CANARY.json"));
  assert.deepEqual(canary.stages.map(({ trafficPercent }) => trafficPercent), [0, 1, 5, 25, 100]);
  assert.deepEqual(canary.stages.map(({ minimumObservationMinutes }) => minimumObservationMinutes), [0, 60, 240, 1440, 4320]);
  assert.equal(canary.stages[0].status, "PREPARED");
  assert.equal(canary.stages.slice(1).every(({ status }) => status === "NOT_RUN"), true);
  assert.ok(canary.stageEntryRequirements.includes("previous_stage_passed"));
  assert.ok(canary.stageEntryRequirements.includes("identity_and_financial_reconciliation_passed"));
});

test("H2 covers every authenticated client and custody surface", async () => {
  const canary = JSON.parse(await read("docs/architecture/TINDIO_PHASE_H2_AUTH_TRAFFIC_CANARY.json"));
  assert.deepEqual(canary.requiredSurfaces, [
    "web_session_lifecycle",
    "backend_bearer_validation",
    "mobile_fresh_install",
    "mobile_in_place_upgrade",
    "tenant_and_store_authorization",
    "data_api_rls",
    "offline_custody_recovery",
  ]);
  assert.ok(canary.requiredEvidencePerStage.includes("financial_duplicate_effect_count"));
  assert.ok(canary.requiredEvidencePerStage.includes("mobile_custody_and_sync_summary"));
});

test("H2 remains at zero traffic and rolls back on every failed gate", async () => {
  const [canarySource, document, packageSource] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_H2_AUTH_TRAFFIC_CANARY.json"),
    read("docs/architecture/TINDIO_PHASE_H2_AUTH_TRAFFIC_CANARY.md"),
    read("package.json"),
  ]);
  const canary = JSON.parse(canarySource);
  assert.equal(canary.currentStage, "H2-0");
  assert.equal(canary.liveTrafficChanged, false);
  assert.equal(canary.productionChangesMade, false);
  assert.equal(canary.automaticActionOnFailedGate, "ROLLBACK_AND_HOLD");
  assert.equal(canary.decision, "NO_GO");
  assert.match(document, /Percentages are hard ceilings, not targets/);
  assert.equal(JSON.parse(packageSource).scripts["test:architecture-phase-h2-auth-traffic-canary"], "node --test scripts/architecture-phase-h2-auth-traffic-canary-check.mjs");
});
