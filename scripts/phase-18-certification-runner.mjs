import {
  spawnSync,
} from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
} from "node:fs";
import {
  dirname,
} from "node:path";

const withDatabase =
  process.argv.includes("--db");

const commands = [
  {
    name:
      "phase18-disaster-model",
    command: "node",
    args: [
      "--test",
      "scripts/phase-18-disaster-model-check.mjs",
    ],
    required: true,
  },
  {
    name:
      "phase18-production-contract",
    command: "node",
    args: [
      "--test",
      "scripts/phase-18-production-failure-contract-check.mjs",
    ],
    required: true,
  },
  {
    name:
      "phase16-isolated-device-contract",
    command: "node",
    args: [
      "--test",
      "scripts/phase-16-isolated-device-mode-check.mjs",
    ],
    required: true,
  },
  {
    name:
      "phase17-sync-control-center-contract",
    command: "node",
    args: [
      "--test",
      "scripts/phase-17-sync-control-center-2-check.mjs",
    ],
    required: true,
  },
  {
    name:
      "inventory-idempotency-recovery",
    command: "node",
    args: [
      "--test",
      "scripts/inventory-idempotency-failure-recovery-check.mjs",
    ],
    required: true,
  },
  {
    name:
      "mobile-typecheck",
    command: "pnpm",
    args: [
      "mobile:typecheck",
    ],
    required: true,
  },
  {
    name:
      "root-typecheck",
    command: "pnpm",
    args: [
      "typecheck",
    ],
    required: true,
  },
];

if (withDatabase) {
  commands.push({
    name:
      "offline-sync-database-regression",
    command: "pnpm",
    args: [
      "exec",
      "supabase",
      "test",
      "db",
      "supabase/tests/database/improvement_13_offline_sync_foundation.test.sql",
    ],
    required: true,
  });
}

const results = [];

for (const item of commands) {
  process.stdout.write(
    `\n[PHASE 18] ${item.name}\n`,
  );

  const result =
    spawnSync(
      item.command,
      item.args,
      {
        encoding: "utf8",
        stdio: [
          "inherit",
          "pipe",
          "pipe",
        ],
        shell:
          process.platform === "win32",
      },
    );

  if (result.stdout) {
    process.stdout.write(
      result.stdout,
    );
  }

  if (result.stderr) {
    process.stderr.write(
      result.stderr,
    );
  }

  results.push({
    name: item.name,
    status:
      result.status === 0
        ? "PASS"
        : "FAIL",
    exitCode:
      result.status,
  });
}

if (!withDatabase) {
  results.push({
    name:
      "offline-sync-database-regression",
    status:
      "DEFERRED_ENVIRONMENT",
    exitCode:
      null,
  });
}

for (
  const runtimeScenario of [
    "real Android app kill during checkout",
    "real phone reboot",
    "real router failure",
    "real API infrastructure outage",
    "real database infrastructure outage",
    "real low-storage behavior",
    "real SQLite migration/filesystem failure",
  ]
) {
  results.push({
    name: runtimeScenario,
    status:
      "DEFERRED_DEVICE_RUNTIME",
    exitCode:
      null,
  });
}

const failed =
  results.filter(
    (result) =>
      result.status === "FAIL",
  );

const evidence = {
  phase: 18,
  generatedAt:
    new Date().toISOString(),
  automatedStatus:
    failed.length === 0
      ? "PASS"
      : "FAIL",
  databaseRuntimeExecuted:
    withDatabase,
  certification:
    "NOT_CERTIFIED",
  reason:
    "Android/device runtime torture scenarios require explicit execution evidence before Phase 18 can become CERTIFIED.",
  guaranteesUnderTest: [
    "NO duplicate money",
    "NO duplicate stock movement",
    "NO silent transaction loss",
    "NO cross-tenant leakage",
  ],
  results,
};

const evidencePath =
  "docs/mobile-program/evidence/PHASE_18_AUTOMATED_RESULTS.json";

mkdirSync(
  dirname(evidencePath),
  {
    recursive: true,
  },
);

writeFileSync(
  evidencePath,
  `${JSON.stringify(
    evidence,
    null,
    2,
  )}\n`,
  "utf8",
);

process.stdout.write(
  `\n[PHASE 18] evidence: ${evidencePath}\n`,
);

if (failed.length > 0) {
  process.exitCode = 1;
}
