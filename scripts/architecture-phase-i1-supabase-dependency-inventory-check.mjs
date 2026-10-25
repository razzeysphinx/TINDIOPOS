import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { classifySupabaseDependency, phaseI1CanonicalDependencies } from "./phase-i-supabase-dependency-inventory.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("I1 classifier separates active code from evidence", () => {
  assert.equal(classifySupabaseDependency("src/lib/supabase/server.ts"), "ACTIVE_RUNTIME");
  assert.equal(classifySupabaseDependency("apps/mobile/src/lib/supabase.ts"), "ACTIVE_RUNTIME");
  assert.equal(classifySupabaseDependency("package.json"), "ACTIVE_BUILD_OR_CONFIGURATION");
  assert.equal(classifySupabaseDependency("supabase/migrations/001.sql"), "HISTORICAL_EVIDENCE_PRESERVE");
});

test("I1 canonical active dependencies exist and retain Supabase markers", async () => {
  for (const entry of phaseI1CanonicalDependencies.filter(({ classification }) => classification !== "HISTORICAL_EVIDENCE_PRESERVE")) {
    await access(new URL(entry.path, root));
  }
  const sources = await Promise.all([
    read("src/lib/supabase/server.ts"),
    read("apps/mobile/src/lib/supabase.ts"),
    read("apps/backend/src/auth/provider.ts"),
    read("package.json")
  ]);
  assert.equal(sources.every((source) => /supabase/i.test(source)), true);
});

test("I1 fails closed under the H5 decision", async () => {
  const [inventory, h5] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_I1_SUPABASE_DEPENDENCY_INVENTORY.json").then(JSON.parse),
    read("docs/architecture/TINDIO_PHASE_H5_GO_NO_GO.json").then(JSON.parse)
  ]);
  assert.equal(inventory.activeRuntimeDependency, true);
  assert.equal(inventory.retirementAllowed, false);
  assert.equal(h5.decision, "NO_GO");
  assert.equal(h5.phaseIRetirementAllowed, false);
});
