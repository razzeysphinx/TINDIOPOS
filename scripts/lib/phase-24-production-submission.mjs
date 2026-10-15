import { evaluatePhase24ProductionEvidence } from "./phase-24-production-evidence.mjs";

const EAS_BUILD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createProductionSubmissionPlan({
  evidence,
  releaseInputs,
  sourceCommitIsAncestor,
  mobileSourceMatchesBuild,
  lockfileSha256,
  workingTreeClean,
  platform = process.platform,
}) {
  const evaluation = evaluatePhase24ProductionEvidence(evidence, releaseInputs);
  const failures = [...evaluation.failures];
  const build = evidence?.signedAab;

  if (sourceCommitIsAncestor !== true) {
    failures.push("Submission sourceCommit: NOT_IN_CURRENT_HISTORY");
  }
  if (mobileSourceMatchesBuild !== true) {
    failures.push("Submission mobile source: BUILD_SOURCE_MISMATCH");
  }
  if (lockfileSha256 !== build?.lockfileSha256) {
    failures.push("Submission lockfileSha256: WORKTREE_LOCKFILE_MISMATCH");
  }
  if (workingTreeClean !== true) {
    failures.push("Submission worktree: NOT_CLEAN");
  }
  if (!EAS_BUILD_ID.test(build?.buildId ?? "")) {
    failures.push("Submission buildId: INVALID_EAS_BUILD_ID");
  }

  if (failures.length > 0) {
    return { allowed: false, failures, command: null };
  }

  return {
    allowed: true,
    failures: [],
    command: {
      executable: platform === "win32" ? "npx.cmd" : "npx",
      args: [
        "eas-cli@latest",
        "submit",
        "--platform",
        "android",
        "--profile",
        "production",
        "--id",
        build.buildId,
        "--non-interactive",
      ],
      cwd: "apps/mobile",
    },
  };
}

export function executeProductionSubmission(plan, spawn) {
  if (!plan.allowed || !plan.command) {
    return { started: false, exitCode: 1 };
  }

  const result = spawn(plan.command.executable, plan.command.args, {
    cwd: plan.command.cwd,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  return { started: true, exitCode: result.status ?? 1 };
}
