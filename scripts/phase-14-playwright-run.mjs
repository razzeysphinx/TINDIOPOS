import process from "node:process";

import {
  parseAndValidateLocalSupabaseStatus,
} from "./lib/certification-safety.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

const ROOT = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = runCommand(
    command,
    args,
    {
      cwd: ROOT,
      env: options.env ?? process.env,
      capture: options.capture ?? false,
    },
  );

  if (result.error || result.status !== 0) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }

    if (result.stderr) {
      process.stderr.write(result.stderr);
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
  let result = runCommand(
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

    result = runCommand(
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
    "Phase 14 browser runner refuses a non-local Supabase API URL.",
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
    "Local service-role/secret key is unavailable for test fixture creation.",
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

  // Phase 14 is the canonical LOCAL browser certification.
  //
  // The developer machine may be configured for the Phase 04 Neon runtime
  // through .env.local. Explicit process environment must win over Next.js
  // dotenv loading so the fixture cannot authenticate against local Supabase
  // while resolving business identity against Neon.
  TINDIO_DATABASE_PROVIDER:
    "supabase",

  TINDIO_E2E_SUPABASE_URL:
    apiUrl,

  // Node-side Playwright fixture only.
  // Never expose this as NEXT_PUBLIC_*.
  TINDIO_E2E_SERVICE_ROLE_KEY:
    serviceRoleKey,
};

console.log(
  "Phase 14 browser target: LOCAL ONLY",
);

console.log(
  "Phase 14 database provider: LOCAL SUPABASE",
);

console.log(
  "Building application for Playwright certification...",
);

run(
  "pnpm",
  ["build"],
  { env },
);

console.log(
  "Running Playwright-managed Chromium certification...",
);

run(
  "pnpm",
  [
    "exec",
    "playwright",
    "test",
    "tests/e2e/phase-14/phase-14-browser.spec.ts",
  ],
  { env },
);

console.log(
  "Generating Phase 14 browser evidence...",
);

run(
  "node",
  [
    "scripts/phase-14-browser-evidence.mjs",
  ],
  { env },
);

console.log(
  "PHASE 14 PLAYWRIGHT BROWSER CERTIFICATION: PASS",
);
