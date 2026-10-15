import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  createProductionSubmissionPlan,
  executeProductionSubmission,
} from "./lib/phase-24-production-submission.mjs";

const evidence = JSON.parse(fs.readFileSync(
  "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json",
  "utf8",
));
const releaseInputs = JSON.parse(fs.readFileSync(
  "apps/mobile/production-release.json",
  "utf8",
));
const gitCheck = (args) => spawnSync("git", args, { stdio: "ignore" }).status === 0;
const gitOutput = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? "";
const sourceCommit = evidence.signedAab?.sourceCommit ?? "";
const sourceCommitIsAncestor = sourceCommit.length > 0
  && gitCheck(["merge-base", "--is-ancestor", sourceCommit, "HEAD"]);
const mobileSourceMatchesBuild = sourceCommit.length > 0
  && gitCheck(["diff", "--quiet", sourceCommit, "--", "apps/mobile"]);
const workingTreeClean = gitOutput(["status", "--porcelain"]) === "";
const lockfileSha256 = createHash("sha256")
  .update(fs.readFileSync("pnpm-lock.yaml"))
  .digest("hex");

const plan = createProductionSubmissionPlan({
  evidence,
  releaseInputs,
  sourceCommitIsAncestor,
  mobileSourceMatchesBuild,
  lockfileSha256,
  workingTreeClean,
});

if (!plan.allowed) {
  process.stderr.write([
    "PHASE_24_PRODUCTION_SUBMISSION_BLOCKED",
    ...plan.failures.map((failure) => `- ${failure}`),
    "",
    "No EAS or Google Play submission was started.",
    "",
  ].join("\n"));
  process.exitCode = 1;
} else {
  process.stdout.write([
    "PHASE_24_PRODUCTION_SUBMISSION_GATE_PASS",
    `Submitting only EAS build ${evidence.signedAab.buildId} to the production draft profile.`,
    "",
  ].join("\n"));
  const result = executeProductionSubmission(plan, spawnSync);
  process.exitCode = result.exitCode;
}
