import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { retirementRequirements } from "./phase-i-retirement-gate.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("I5 consolidates all five repository slices", async () => {
  const decision = JSON.parse(await read("docs/architecture/TINDIO_PHASE_I5_DECOMMISSION_DECISION.json"));
  assert.deepEqual(decision.sliceStatus.map(({ slice }) => slice), ["I1", "I2", "I3", "I4", "I5"]);
  assert.equal(decision.repositorySlicesComplete, true);
});

test("I5 decision is non-destructive and unsigned", async () => {
  const decision = JSON.parse(await read("docs/architecture/TINDIO_PHASE_I5_DECOMMISSION_DECISION.json"));
  assert.equal(decision.decision, "DO_NOT_DECOMMISSION");
  assert.equal(decision.retirementGatePassed, false);
  assert.equal(decision.dependenciesRemoved, false);
  assert.equal(decision.supabaseProjectChanged, false);
  assert.equal(decision.supabaseProjectDeleted, false);
  assert.equal(Object.values(decision.approvalRecord).every((value) => value === null), true);
});

test("I5 checklist covers every retirement control domain", async () => {
  const checklist = await read("docs/architecture/TINDIO_SUPABASE_RETIREMENT_CHECKLIST.md");
  assert.equal((checklist.match(/- \[ \]/g) ?? []).length, 10);
  for (const phrase of ["supported client", "Tenant isolation", "Financial replay", "custody", "backup", "named owner"]) {
    assert.match(checklist, new RegExp(phrase, "i"));
  }
  assert.equal(retirementRequirements.length, 12);
});

test("I5 retains H5 NO GO and active I1 dependency evidence", async () => {
  const [h5, i1] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_H5_GO_NO_GO.json").then(JSON.parse),
    read("docs/architecture/TINDIO_PHASE_I1_SUPABASE_DEPENDENCY_INVENTORY.json").then(JSON.parse)
  ]);
  assert.equal(h5.decision, "NO_GO");
  assert.equal(i1.activeRuntimeDependency, true);
  assert.equal(i1.retirementAllowed, false);
});
