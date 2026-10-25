import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { retirementRequirements } from "./phase-i-retirement-gate.mjs";
import { planSupabaseRemoval } from "./phase-i-removal-planner.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const complete = () => Object.fromEntries(retirementRequirements.map((key) => [key, true]));

test("I3 planner refuses removal while retirement requirements are absent", () => {
  const plan = planSupabaseRemoval({}, ["src/lib/supabase/server.ts"]);
  assert.equal(plan.executable, false);
  assert.equal(plan.decision, "PLAN_ONLY_DO_NOT_EXECUTE");
});

test("I3 planner never treats historical evidence as a removal target", () => {
  const plan = planSupabaseRemoval(complete(), ["supabase/migrations/001.sql", "docs/archive/audit.md"]);
  assert.equal(plan.executable, false);
  assert.deepEqual(plan.protectedPaths, ["supabase/migrations/001.sql", "docs/archive/audit.md"]);
});

test("I3 manifest is ordered, non-destructive, and excludes project deletion", async () => {
  const manifest = JSON.parse(await read("docs/architecture/TINDIO_PHASE_I3_REMOVAL_MANIFEST.json"));
  assert.deepEqual(manifest.orderedOperations.map(({ order }) => order), [1, 2, 3, 4, 5]);
  assert.equal(manifest.removalExecuted, false);
  assert.equal(manifest.projectDeletionIncluded, false);
  assert.equal(manifest.currentDecision, "PLAN_ONLY_DO_NOT_EXECUTE");
});
