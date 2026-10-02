import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  R8_STARTING_HEAD,
  TARGET_DATA_API_HOST,
  verifiedIdentities,
  writeR8Evidence,
} from "./common.mjs";
import { runCommand } from "../../lib/run-command.mjs";

function git(...args) {
  const result = runCommand(
    "git",
    args,
    { capture: true },
  );

  assert.equal(
    result.status,
    0,
    String(result.stderr),
  );

  return String(result.stdout).trim();
}

const branch = git("branch", "--show-current");
const localHead = git("rev-parse", "HEAD");
const remoteHead = git(
  "ls-remote",
  "origin",
  "refs/heads/recovery/neon-canonical-rebuild",
).split(/\s+/u)[0];
const status = git("status", "--porcelain=v1");
const sourceOfTruth = await readFile(
  "docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md",
  "utf8",
);

assert.equal(branch, "recovery/neon-canonical-rebuild");
assert.equal(localHead, R8_STARTING_HEAD);
assert.equal(remoteHead, R8_STARTING_HEAD);
assert.equal(
  status,
  "?? docs/recovery/TINDIO_NEON_RECOVERY_R4_HANDOVER.md",
);
assert.match(sourceOfTruth, /^R7  COMPLETE$/m);
assert.match(sourceOfTruth, /^R8  NEXT \/ NOT STARTED$/m);
assert.match(sourceOfTruth, /^R9  NOT STARTED$/m);

const identities = await verifiedIdentities();
const evidence = {
  generatedAt: new Date().toISOString(),
  branch,
  localHead,
  remoteHead,
  trackedWorkingTree: "CLEAN",
  r4Handover: "UNTRACKED / PRESERVED / UNMODIFIED",
  source: identities.sourceIdentity,
  target: identities.targetIdentity,
  targetDataApiHost: TARGET_DATA_API_HOST,
  sourceReadOnly: true,
  productionConfigurationChanged: false,
  productionCutoverStarted: false,
};

await writeR8Evidence(
  "pre-cutover-state.json",
  evidence,
);

console.log(JSON.stringify(evidence, null, 2));
console.log("TINDIO R8 PRE-CUTOVER PREFLIGHT: PASS");
