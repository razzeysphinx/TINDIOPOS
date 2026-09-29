import fs from "node:fs";

const path =
  "docs/mobile-program/evidence/PHASE_24_GOOGLE_PLAY_RELEASE_EVIDENCE.json";

const evidence =
  JSON.parse(
    fs.readFileSync(
      path,
      "utf8",
    ),
  );

const scenarios =
  Object.entries(
    evidence.realStoreScenarios,
  );

const failures = [];

function requirePass(
  label,
  status,
) {
  if (status !== "PASS") {
    failures.push(
      `${label}: ${status}`,
    );
  }
}

requirePass(
  "Signed AAB",
  evidence.signedAab.status,
);

requirePass(
  "Development device",
  evidence.developmentDevice.status,
);

requirePass(
  "Internal testing",
  evidence.internalTesting.status,
);

requirePass(
  "Closed testing",
  evidence.closedTesting.status,
);

requirePass(
  "Pilot merchants",
  evidence.pilotMerchants.status,
);

for (
  const [
    name,
    status,
  ]
  of scenarios
) {
  requirePass(
    `Scenario ${name}`,
    status,
  );
}

if (failures.length > 0) {
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
