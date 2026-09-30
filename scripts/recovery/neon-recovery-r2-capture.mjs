import assert from "node:assert/strict";

import {
  createHash,
} from "node:crypto";

import {
  readFile,
} from "node:fs/promises";

import process from "node:process";

import {
  runCommand,
} from "../lib/run-command.mjs";

function run(
  command,
  args,
) {
  console.log(
    `$ ${command} ${args.join(" ")}`,
  );

  const result =
    runCommand(
      command,
      args,
      {
        cwd:
          process.cwd(),

        env:
          process.env,

        capture:
          false,
      },
    );

  if (
    result.error
    || result.status !== 0
  ) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}`,
    );
  }
}

async function baselineHash() {
  const bytes =
    await readFile(
      "database/baseline/0001_tindio_baseline.sql",
    );

  return createHash(
    "sha256",
  )
    .update(
      bytes,
    )
    .digest(
      "hex",
    );
}

console.log(
  "TINDIO R2 canonical baseline construction",
);

console.log(
  "Terminal contract: Git Bash commands only.",
);

console.log(
  "Live Neon writes: FORBIDDEN.",
);

run(
  "pnpm",
  [
    "recovery:neon:preflight",
  ],
);

run(
  "pnpm",
  [
    "certify:preflight",
  ],
);

run(
  "pnpm",
  [
    "certify:db",
  ],
);

run(
  "node",
  [
    "scripts/capture-database-baseline.mjs",
  ],
);

run(
  "node",
  [
    "scripts/recovery/neon-recovery-r2-baseline-manifest.mjs",
  ],
);

const firstHash =
  await baselineHash();

run(
  "node",
  [
    "scripts/capture-database-baseline.mjs",
  ],
);

run(
  "node",
  [
    "scripts/recovery/neon-recovery-r2-baseline-manifest.mjs",
  ],
);

const secondHash =
  await baselineHash();

assert.equal(
  secondHash,
  firstHash,
  "Canonical baseline is not deterministic across two clean local captures.",
);

run(
  "node",
  [
    "--test",
    "scripts/recovery/neon-recovery-r2-baseline-check.mjs",
  ],
);

console.log(
  "TINDIO R2 CANONICAL BASELINE: PASS",
);

console.log(
  JSON.stringify(
    {
      deterministic:
        true,

      sha256:
        secondHash,

      baseline:
        "database/baseline/0001_tindio_baseline.sql",

      manifest:
        "database/baseline/0001_tindio_baseline.manifest.json",

      liveNeonWrites:
        0,
    },
    null,
    2,
  ),
);
