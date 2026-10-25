import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateSupabaseRetirement, retirementRequirements } from "./phase-i-retirement-gate.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const complete = () => Object.fromEntries(retirementRequirements.map((key) => [key, true]));

test("I2 retirement gate rejects absent, partial, and non-boolean evidence", () => {
  assert.deepEqual(evaluateSupabaseRetirement().missingRequirements, [...retirementRequirements]);
  const evidence = complete();
  evidence.noSupportedClientUsesSupabaseTokens = false;
  evidence.explicitOwnerDecommissionApproval = "approved";
  assert.deepEqual(evaluateSupabaseRetirement(evidence).missingRequirements, [
    "noSupportedClientUsesSupabaseTokens",
    "explicitOwnerDecommissionApproval"
  ]);
});

test("I2 complete synthetic evidence establishes eligibility, not deletion", () => {
  assert.deepEqual(evaluateSupabaseRetirement(complete()), {
    allowed: true,
    decision: "ELIGIBLE_FOR_SEPARATE_DECOMMISSION_APPROVAL",
    missingRequirements: []
  });
});

test("I2 repository evidence remains fail closed", async () => {
  const gate = JSON.parse(await read("docs/architecture/TINDIO_PHASE_I2_RETIREMENT_GATE.json"));
  assert.equal(gate.requirementsRequired, retirementRequirements.length);
  assert.equal(gate.retirementAllowed, false);
  assert.equal(gate.supabaseTokenAcceptanceCanEnd, false);
  assert.equal(gate.ownerDecommissionApproval, false);
  assert.equal(gate.decision, "DO_NOT_RETIRE");
});
