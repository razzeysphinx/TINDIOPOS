import assert from "node:assert/strict";
import process from "node:process";

import {
  runSql,
} from "./lib/phase-04-postgres-docker.mjs";

import {
  runCommand,
} from "./lib/run-command.mjs";

function fail(
  message,
) {
  console.error(
    message,
  );

  process.exit(1);
}

const result =
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
      cwd:
        process.cwd(),

      env:
        process.env,

      capture:
        true,
    },
  );

if (
  result.error
  || result.status !== 0
) {
  fail(
    "Local Supabase source is unavailable.",
  );
}

const status =
  JSON.parse(
    String(
      result.stdout,
    ),
  );

const sourceUrl =
  status.DB_URL;

if (
  typeof sourceUrl
  !== "string"
) {
  fail(
    "Supabase status did not return DB_URL.",
  );
}

const parsed =
  new URL(
    sourceUrl,
  );

const hostname =
  parsed.hostname
    .replace(
      /^\[/,
      "",
    )
    .replace(
      /\]$/,
      "",
    )
    .toLowerCase();

assert.ok(
  [
    "localhost",
    "127.0.0.1",
    "::1",
  ].includes(
    hostname,
  ),
  "Phase 04 local rehearsal source must be local Supabase PostgreSQL.",
);

const answer =
  runSql(
    sourceUrl,
    "select 1;",
  );

assert.equal(
  answer,
  "1",
  "Docker PostgreSQL utilities could not reach the local Supabase database through the host bridge.",
);

console.log(
  "PHASE 04 DOCKER SOURCE CONNECTIVITY: PASS",
);
