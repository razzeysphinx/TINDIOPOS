import fs from "node:fs";
import { evaluatePhase24ProductionEvidence } from "./lib/phase-24-production-evidence.mjs";

const path =
  "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json";

const evidence =
  JSON.parse(
    fs.readFileSync(
      path,
      "utf8",
    ),
  );

const releaseInputs = JSON.parse(
  fs.readFileSync(
    "apps/mobile/production-release.json",
    "utf8",
  ),
);

const { passed, failures } = evaluatePhase24ProductionEvidence(evidence, releaseInputs);

if (!passed) {
  process.stderr.write(
    [
      "PHASE_24_PRODUCTION_BLOCKED",
      ...failures.map(
        (failure) =>
          `- ${failure}`,
      ),
      "",
      "Do not submit a completed production release.",
      "",
    ].join("\n"),
  );

  process.exitCode = 1;
} else {
  process.stdout.write(
    [
      "PHASE_24_PRODUCTION_EVIDENCE_GATE_PASS",
      "The evidence file satisfies the repository release gate.",
      "Human review and Google Play review are still required.",
      "",
    ].join("\n"),
  );
}
