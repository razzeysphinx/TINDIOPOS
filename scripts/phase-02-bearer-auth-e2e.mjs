import process from "node:process";

import {
  parseAndValidateLocalSupabaseStatus,
} from "./lib/certification-safety.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

const ROOT =
  process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(
  command,
  args,
  options = {},
) {
  const result =
    runCommand(
      command,
      args,
      {
        cwd: ROOT,
        env:
          options.env
          ?? process.env,
        capture:
          options.capture
          ?? false,
      },
    );

  if (
    result.error
    || result.status !== 0
  ) {
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

    fail(
      `${command} ${args.join(" ")} failed.`,
    );
  }

  return String(
    result.stdout ?? "",
  ).trim();
}

function getLocalStatus() {
  let result =
    runCommand(
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

  if (
    result.error
    || result.status !== 0
  ) {
    run(
      "pnpm",
      [
        "exec",
        "supabase",
        "start",
      ],
    );

    result =
      runCommand(
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

  if (
    result.error
    || result.status !== 0
  ) {
    fail(
      "Local Supabase status could not be obtained.",
    );
  }

  const output =
    String(
      result.stdout ?? "",
    );

  parseAndValidateLocalSupabaseStatus(
    output,
  );

  return JSON.parse(
    output,
  );
}

const status =
  getLocalStatus();

const apiUrl =
  status.API_URL;

const publishableKey =
  status.PUBLISHABLE_KEY
  ?? status.ANON_KEY;

const serviceRoleKey =
  status.SERVICE_ROLE_KEY
  ?? status.SECRET_KEY;

if (
  typeof apiUrl !== "string"
  || !/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/i
    .test(apiUrl)
) {
  fail(
    "Phase 02 bearer certification refuses a non-local Supabase API URL.",
  );
}

if (
  typeof publishableKey !== "string"
  || publishableKey.length < 10
) {
  fail(
    "Local publishable/anon key is unavailable.",
  );
}

if (
  typeof serviceRoleKey !== "string"
  || serviceRoleKey.length < 10
) {
  fail(
    "Local service-role/secret key is unavailable for fixture creation.",
  );
}

const env = {
  ...process.env,

  NEXT_PUBLIC_APP_URL:
    "http://127.0.0.1:3100",

  NEXT_PUBLIC_SUPABASE_URL:
    apiUrl,

  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    publishableKey,

  TINDIO_E2E_SUPABASE_URL:
    apiUrl,

  TINDIO_E2E_SUPABASE_PUBLISHABLE_KEY:
    publishableKey,

  TINDIO_E2E_SERVICE_ROLE_KEY:
    serviceRoleKey,

  TINDIO_E2E_RUN_ID:
    process.env
      .TINDIO_E2E_RUN_ID
    ?? Date.now().toString(),
};

console.log(
  "Phase 02 bearer-auth target: LOCAL ONLY",
);

console.log(
  "Building application for Phase 02 certification...",
);

run(
  "pnpm",
  [
    "build",
  ],
  {
    env,
  },
);

console.log(
  "Running Phase 02 bearer-auth Chromium/API certification...",
);

run(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "--config=playwright.phase-02.config.ts",
  ],
  {
    env,
  },
);

console.log(
  "PHASE 02 BEARER AUTH CERTIFICATION: PASS",
);
