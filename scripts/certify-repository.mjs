import {
  readFile,
} from "node:fs/promises";

import path from "node:path";
import process from "node:process";

import {
  verifyGeneratedTextContract,
} from "./lib/certification-contract.mjs";

import {
  parseAndValidateLocalSupabaseStatus,
} from "./lib/certification-safety.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

const ROOT = process.cwd();

const PACKAGE_PATH =
  path.join(
    ROOT,
    "package.json",
  );

const DATABASE_TYPES_PATH =
  path.join(
    ROOT,
    "src",
    "lib",
    "supabase",
    "database.types.ts",
  );

/*
 * These package tests are real tests, but cannot run as unattended static
 * certification because they require an authenticated live application
 * session or other deliberately prepared runtime fixture.
 *
 * Every other test:* command is automatically certified.
 *
 * Adding another entry here must be an explicit code change so future tests
 * cannot silently escape certification.
 */
const MANUAL_INTEGRATION_TESTS =
  new Set([
    "test:tenant-load",
  ]);

const VALID_MODES =
  new Set([
    "--static",
    "--db",
    "--all",
  ]);

const argumentsSet =
  new Set(
    process.argv.slice(2),
  );

const selectedModes =
  [...argumentsSet].filter(
    (argument) =>
      VALID_MODES.has(argument),
  );

if (
  selectedModes.length !== 1
  || argumentsSet.size !== 1
) {
  console.error(
    "Usage:",
  );

  console.error(
    "  node scripts/certify-repository.mjs --static",
  );

  console.error(
    "  node scripts/certify-repository.mjs --db",
  );

  console.error(
    "  node scripts/certify-repository.mjs --all",
  );

  process.exit(2);
}

const mode =
  selectedModes[0];

function fail(message) {
  console.error("");

  console.error(
    `CERTIFICATION FAILED: ${message}`,
  );

  process.exit(1);
}

function runStep({
  name,
  command,
  args = [],
  capture = false,
}) {
  console.log("");

  console.log(
    `=== ${name} ===`,
  );

  console.log(
    `$ ${command} ${args.join(" ")}`,
  );

  const result =
    runCommand(
      command,
      args,
      {
        cwd: ROOT,
        env: process.env,
        capture,
      },
    );

  if (result.error) {
    console.error(
      result.error.message,
    );

    fail(name);
  }

  if (result.status !== 0) {
    if (capture) {
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
    }

    fail(name);
  }

  return result;
}

function runCollectableStep({
  name,
  command,
  args = [],
}) {
  console.log("");

  console.log(
    `=== ${name} ===`,
  );

  console.log(
    `$ ${command} ${args.join(" ")}`,
  );

  const result =
    runCommand(
      command,
      args,
      {
        cwd: ROOT,
        env: process.env,
      },
    );

  if (result.error) {
    console.error(
      result.error.message,
    );

    return {
      name,
      reason:
        result.error.message,
    };
  }

  if (result.status !== 0) {
    console.error(
      `FAILED: ${name}`,
    );

    return {
      name,
      reason:
        `exit code ${result.status ?? 1}`,
    };
  }

  return null;
}

async function readPackage() {
  return JSON.parse(
    await readFile(
      PACKAGE_PATH,
      "utf8",
    ),
  );
}

function validateTestCatalogue(
  packageJson,
) {
  const scripts =
    packageJson.scripts ?? {};

  const allTests =
    Object.entries(scripts)
      .filter(
        ([name]) =>
          name.startsWith(
            "test:",
          ),
      );

  if (allTests.length === 0) {
    fail(
      "package.json contains no test:* scripts.",
    );
  }

  const databaseControlPattern =
    /\b(?:supabase\s+(?:db|test|start|stop|status)|psql|pg_dump|pg_restore)\b/i;

  for (
    const [name, command]
    of allTests
  ) {
    if (
      typeof command !== "string"
      || command.trim() === ""
    ) {
      fail(
        `${name} has no executable command.`,
      );
    }

    if (
      /\bcertify(?::|\b)/i
        .test(command)
    ) {
      fail(
        `${name} recursively references certification.`,
      );
    }

    if (
      !MANUAL_INTEGRATION_TESTS
        .has(name)
      && databaseControlPattern
        .test(command)
    ) {
      fail(
        `${name} contains a direct database-control command and must be deliberately moved behind the DB safety gate.`,
      );
    }
  }

  const manualTests =
    allTests.filter(
      ([name]) =>
        MANUAL_INTEGRATION_TESTS
          .has(name),
    );

  const automatedTests =
    allTests.filter(
      ([name]) =>
        !MANUAL_INTEGRATION_TESTS
          .has(name),
    );

  return {
    allTests,
    automatedTests,
    manualTests,
  };
}

function assertTrackedMigrationsClean() {
  const result =
    runCommand(
      "git",
      [
        "status",
        "--porcelain",
        "--untracked-files=all",
        "--",
        "supabase/migrations",
      ],
      {
        cwd: ROOT,
        env: process.env,
        capture: true,
      },
    );

  if (
    result.error
    || result.status !== 0
  ) {
    fail(
      "Unable to inspect tracked migration working-tree state.",
    );
  }

  const output =
    (
      result.stdout ?? ""
    ).trim();

  if (output.length > 0) {
    console.error("");

    console.error(
      output,
    );

    fail(
      "Migration directory contains uncommitted changes. Commit approved forward migrations before authoritative certification; historical migrations are immutable.",
    );
  }

  console.log(
    "Migration working tree: CLEAN",
  );
}

function assertLocalSupabaseStatus(
  output,
) {
  try {
    return (
      parseAndValidateLocalSupabaseStatus(
        output,
      )
    );
  } catch (error) {
    fail(
      error instanceof Error
        ? error.message
        : "Supabase status validation failed.",
    );
  }
}

function getLocalSupabaseStatus() {
  return runCommand(
    "pnpm",
    [
      "exec",
      "supabase",
      "status",
      "--output",
      "json",
    ],
    {
      cwd: ROOT,
      env: process.env,
      capture: true,
    },
  );
}

function ensureLocalSupabase() {
  let status =
    getLocalSupabaseStatus();

  if (
    status.error
    || status.status !== 0
  ) {
    console.log("");

    console.log(
      "Local Supabase is not running. Starting local stack...",
    );

    const start =
      runCommand(
        "pnpm",
        [
          "exec",
          "supabase",
          "start",
        ],
        {
          cwd: ROOT,
          env: process.env,
          capture: true,
        },
      );

    if (
      start.error
      || start.status !== 0
    ) {
      if (start.stdout) {
        process.stdout.write(
          start.stdout,
        );
      }

      if (start.stderr) {
        process.stderr.write(
          start.stderr,
        );
      }

      fail(
        "Local Supabase could not be started.",
      );
    }

    status =
      getLocalSupabaseStatus();
  }

  if (
    status.error
    || status.status !== 0
  ) {
    fail(
      "Local Supabase status could not be confirmed.",
    );
  }

  assertLocalSupabaseStatus(
    status.stdout ?? "",
  );

  console.log(
    "Local Supabase status: CONFIRMED LOCAL",
  );
}

async function verifyGeneratedTypesStable() {
  console.log("");

  console.log(
    "=== Generate database types from local schema ===",
  );

  console.log(
    "$ node scripts/generate-local-database-types.mjs",
  );

  let verification;

  try {
    verification =
      await verifyGeneratedTextContract({
        filePath:
          DATABASE_TYPES_PATH,

        label:
          "Generated database.types.ts",

        generate:
          () =>
            runCommand(
              "node",
              [
                "scripts/generate-local-database-types.mjs",
              ],
              {
                cwd:
                  ROOT,

                env:
                  process.env,

                capture:
                  true,
              },
            ),
      });
  } catch (error) {
    const commandResult =
      error
      && typeof error === "object"
      && "commandResult" in error
        ? error.commandResult
        : null;

    if (
      commandResult
      && commandResult.stdout
    ) {
      process.stdout.write(
        commandResult.stdout,
      );
    }

    if (
      commandResult
      && commandResult.stderr
    ) {
      process.stderr.write(
        commandResult.stderr,
      );
    }

    fail(
      error instanceof Error
        ? error.message
        : "Generated database type verification failed.",
    );
  }

  if (
    verification.bytesChanged
  ) {
    console.log(
      "Generated database type bytes changed only in an equivalent normalized representation; original bytes restored.",
    );
  }

  console.log(
    "Generated database type contract: STABLE",
  );
}

async function runStaticCertification() {
  console.log("");

  console.log(
    "TINDIO STATIC REPOSITORY CERTIFICATION",
  );

  console.log(
    "======================================",
  );

  assertTrackedMigrationsClean();

  const packageJson =
    await readPackage();

  const {
    allTests,
    automatedTests,
    manualTests,
  } =
    validateTestCatalogue(
      packageJson,
    );

  console.log(
    `Discovered package test commands: ${allTests.length}`,
  );

  console.log(
    `Automated package test commands: ${automatedTests.length}`,
  );

  console.log(
    `Manual integration package tests: ${manualTests.length}`,
  );

  if (
    manualTests.length > 0
  ) {
    console.log("");

    console.log(
      "Deferred manual integration tests:",
    );

    for (
      const [testName]
      of manualTests
    ) {
      console.log(
        `- ${testName}`,
      );
    }
  }

  const packageTestFailures =
    [];

  for (
    const [testName]
    of automatedTests
  ) {
    const failure =
      runCollectableStep({
        name:
          `Package test ${testName}`,
        command: "pnpm",
        args: [
          "run",
          testName,
        ],
      });

    if (failure) {
      packageTestFailures.push(
        failure,
      );
    }
  }

  if (
    packageTestFailures.length > 0
  ) {
    console.error("");

    console.error(
      "PACKAGE TEST FAILURE SUMMARY",
    );

    console.error(
      "============================",
    );

    for (
      const failure
      of packageTestFailures
    ) {
      console.error(
        `- ${failure.name}: ${failure.reason}`,
      );
    }

    console.error("");

    console.error(
      `Failed automated package tests: ${packageTestFailures.length}/${automatedTests.length}`,
    );

    fail(
      "automated package test catalogue contains failures",
    );
  }

  console.log("");

  console.log(
    `Package test catalogue: PASS (${automatedTests.length}/${automatedTests.length} automated; ${manualTests.length} manual deferred)`,
  );

  const foundationChecks = [
    {
      name:
        "Provider-neutral identity foundation",
      command: "node",
      args: [
        "--test",
        "scripts/provider-neutral-identity-foundation-check.mjs",
      ],
    },

    {
      name:
        "Provider-neutral identity resolution",
      command: "node",
      args: [
        "--test",
        "scripts/provider-neutral-identity-resolution-check.mjs",
      ],
    },

    {
      name:
        "Provider-neutral core authorization",
      command: "node",
      args: [
        "--test",
        "scripts/provider-neutral-core-authorization-check.mjs",
      ],
    },

    {
      name:
        "Provider-neutral application authentication",
      command: "node",
      args: [
        "--test",
        "scripts/provider-neutral-application-auth-check.mjs",
      ],
    },

    {
      name:
        "Inventory transfer RBAC migration deterministic check",
      command: "node",
      args: [
        "scripts/rebuild-inventory-transfer-rbac.mjs",
        "--check",
      ],
    },

    {
      name:
        "Database foundation tooling safety",
      command: "node",
      args: [
        "--test",
        "scripts/database-foundation-tooling-check.mjs",
      ],
    },

    {
      name:
        "Database portability inventory",
      command: "node",
      args: [
        "scripts/database-portability-audit.mjs",
      ],
    },
  ];

  for (
    const step
    of foundationChecks
  ) {
    runStep(step);
  }

  assertTrackedMigrationsClean();

  runStep({
    name:
      "Git whitespace validation",
    command: "git",
    args: [
      "diff",
      "--check",
    ],
  });

  runStep({
    name:
      "TypeScript",
    command: "pnpm",
    args: [
      "typecheck",
    ],
  });

  runStep({
    name:
      "ESLint",
    command: "pnpm",
    args: [
      "lint",
    ],
  });

  runStep({
    name:
      "Production build",
    command: "pnpm",
    args: [
      "build",
    ],
  });

  console.log("");

  console.log(
    "STATIC CERTIFICATION: PASS",
  );
}

async function runDatabaseCertification() {
  console.log("");

  console.log(
    "TINDIO LOCAL DATABASE CERTIFICATION",
  );

  console.log(
    "===================================",
  );

  runStep({
    name:
      "Local database target safety preflight",
    command: "node",
    args: [
      "scripts/certification-local-target-preflight.mjs",
    ],
  });

  assertTrackedMigrationsClean();

  ensureLocalSupabase();

  runStep({
    name:
      "Clean local migration replay",
    command: "pnpm",
    args: [
      "exec",
      "supabase",
      "db",
      "reset",
      "--local",
    ],
  });

  runStep({
    name:
      "Complete local pgTAP suite",
    command: "pnpm",
    args: [
      "exec",
      "supabase",
      "test",
      "db",
      "--local",
    ],
  });

  runStep({
    name:
      "Database lint â€” blocking errors",
    command: "pnpm",
    args: [
      "exec",
      "supabase",
      "db",
      "lint",
      "--local",
      "--level",
      "error",
      "--fail-on",
      "error",
    ],
  });

  runStep({
    name:
      "Inventory reconciliation and concurrency evidence",
    command: "node",
    args: [
      "scripts/inventory-reconciliation-concurrency-certification.mjs",
    ],
  });

  runStep({
    name:
      "Canonical transfer concurrency evidence",
    command: "node",
    args: [
      "scripts/inventory-transfer-concurrency-certification.mjs",
    ],
  });

  await verifyGeneratedTypesStable();

  assertTrackedMigrationsClean();

  runStep({
    name:
      "Post-database git whitespace validation",
    command: "git",
    args: [
      "diff",
      "--check",
    ],
  });

  console.log("");

  console.log(
    "DATABASE CERTIFICATION: PASS",
  );
}

console.log(
  "TINDIO AUTHORITATIVE REPOSITORY CERTIFICATION",
);

console.log(
  "=============================================",
);

console.log(
  `Mode: ${mode}`,
);

if (
  mode === "--static"
) {
  await runStaticCertification();
}

if (
  mode === "--db"
) {
  await runDatabaseCertification();
}

if (
  mode === "--all"
) {
  await runStaticCertification();

  await runDatabaseCertification();
}

console.log("");

console.log(
  "=============================================",
);

console.log(
  "TINDIO AUTOMATED CERTIFICATION PASSED",
);
