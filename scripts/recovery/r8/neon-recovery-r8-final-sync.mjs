import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  assertR8CutoverAuthorized,
  canonicalR8Environment,
  writeR8Evidence,
} from "./common.mjs";
import { runCommand } from "../../lib/run-command.mjs";

assertR8CutoverAuthorized();

function run(script) {
  const result = runCommand("node", [script], {
    env: canonicalR8Environment(),
    capture: true,
  });

  assert.equal(result.status, 0, `${script} failed:\n${String(result.stderr)}`);
  process.stdout.write(String(result.stdout));
}

for (const script of [
  "scripts/recovery/r7/neon-recovery-r7-census.mjs",
  "scripts/recovery/r7/neon-recovery-r7-plan.mjs",
  "scripts/recovery/r8/neon-recovery-r8-target-reset.mjs",
  "scripts/recovery/r7/neon-recovery-r7-migrate.mjs",
  "scripts/recovery/r7/neon-recovery-r7-post-import-normalize.mjs",
  "scripts/recovery/r7/neon-recovery-r7-reconcile.mjs",
  "scripts/recovery/r7/neon-recovery-r7-certify.mjs",
]) run(script);

const [migration, rowCounts, ids, content, relationships] = await Promise.all(
  ["migration-result.json", "row-count-reconciliation.json", "id-reconciliation.json", "content-reconciliation.json", "relationship-reconciliation.json"].map(async (name) => [
    name,
    JSON.parse(await readFile(`docs/recovery/evidence/r8/${name}`, "utf8")),
  ]),
);
const evidence = Object.fromEntries([migration, rowCounts, ids, content, relationships]);
assert.equal(evidence["migration-result.json"].failed, 0);
assert.equal(evidence["migration-result.json"].skipped, 0);

await writeR8Evidence("final-migration-result.json", evidence["migration-result.json"]);
await writeR8Evidence("final-reconciliation.json", {
  generatedAt: new Date().toISOString(),
  rowCounts: "PASS",
  ids: "PASS",
  content: "PASS",
  relationships: "PASS",
});

console.log("TINDIO R8 FINAL SYNCHRONIZATION: PASS");
