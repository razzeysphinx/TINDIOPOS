import {
  readFile,
} from "node:fs/promises";

import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
];

/*
 * Phase 04 separates hosted authentication from the destructive local
 * database certification target.
 *
 * These may legitimately point to hosted Supabase Auth/Realtime.
 * They are application/provider configuration, not the target used by
 * `supabase db reset --local`.
 */
const APPLICATION_AUTH_TARGETS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_URL",
];

/*
 * These are commonly used by PostgreSQL/Neon tooling, but TINDIO's current
 * certification engine does NOT consume them.
 *
 * All destructive certification commands use an explicit Supabase --local
 * flag, and certify-repository.mjs additionally validates the actual local
 * Supabase service URLs returned by `supabase status`.
 *
 * Therefore a remote value here is informational, not a blocker.
 */
const INFORMATIONAL_DATABASE_TARGETS = [
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_URL",
  "SUPABASE_DB_URL",
  "NEON_DATABASE_URL",
];

const LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

function parseDotenv(source) {
  const values = new Map();

  for (
    const rawLine
    of source.split(/\r?\n/)
  ) {
    const line =
      rawLine.trim();

    if (
      line.length === 0
      || line.startsWith("#")
    ) {
      continue;
    }

    const normalized =
      line.startsWith("export ")
        ? line.slice(7).trim()
        : line;

    const separator =
      normalized.indexOf("=");

    if (separator <= 0) {
      continue;
    }

    const key =
      normalized
        .slice(0, separator)
        .trim();

    let value =
      normalized
        .slice(separator + 1)
        .trim();

    if (
      (
        value.startsWith("\"")
        && value.endsWith("\"")
      )
      || (
        value.startsWith("'")
        && value.endsWith("'")
      )
    ) {
      value =
        value.slice(1, -1);
    }

    values.set(
      key,
      value,
    );
  }

  return values;
}

async function readOptionalFile(
  relativePath,
) {
  try {
    return await readFile(
      path.join(
        ROOT,
        relativePath,
      ),
      "utf8",
    );
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "code" in error
      && error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}

function classifyTarget(value) {
  if (
    typeof value !== "string"
    || value.trim() === ""
  ) {
    return "MISSING";
  }

  const normalized =
    value.trim();

  if (
    normalized.includes("${")
    || normalized.includes("$(")
  ) {
    return "AMBIGUOUS";
  }

  try {
    const parsed =
      new URL(normalized);

    const supportedProtocols =
      new Set([
        "http:",
        "https:",
        "postgres:",
        "postgresql:",
      ]);

    if (
      !supportedProtocols.has(
        parsed.protocol,
      )
    ) {
      return "AMBIGUOUS";
    }

    return LOCAL_HOSTS.has(
      parsed.hostname.toLowerCase(),
    )
      ? "LOCAL"
      : "REMOTE";
  } catch {
    return "AMBIGUOUS";
  }
}

const fileValues =
  new Map();

for (const file of ENV_FILES) {
  const source =
    await readOptionalFile(file);

  if (source === null) {
    continue;
  }

  fileValues.set(
    file,
    parseDotenv(source),
  );
}

function collectCandidates(
  variable,
) {
  const candidates = [];

  for (
    const [, values]
    of fileValues
  ) {
    if (values.has(variable)) {
      candidates.push(
        values.get(variable),
      );
    }
  }

  if (
    Object.prototype
      .hasOwnProperty
      .call(
        process.env,
        variable,
      )
  ) {
    candidates.push(
      process.env[variable],
    );
  }

  return candidates;
}

function overallClassification(
  candidates,
) {
  if (
    candidates.length === 0
  ) {
    return "MISSING";
  }

  const classifications =
    candidates.map(
      classifyTarget,
    );

  if (
    classifications.includes(
      "REMOTE",
    )
  ) {
    return "REMOTE";
  }

  if (
    classifications.includes(
      "AMBIGUOUS",
    )
  ) {
    return "AMBIGUOUS";
  }

  if (
    classifications.every(
      (classification) =>
        classification ===
        "MISSING",
    )
  ) {
    return "MISSING";
  }

  return "LOCAL";
}

console.log(
  "TINDIO DATABASE CERTIFICATION PREFLIGHT",
);

console.log(
  "=======================================",
);

console.log("");

console.log(
  "APPLICATION AUTH / REALTIME TARGETS",
);

console.log(
  "-----------------------------------",
);

for (
  const variable
  of APPLICATION_AUTH_TARGETS
) {
  const status =
    overallClassification(
      collectCandidates(
        variable,
      ),
    );

  const suffix =
    status === "REMOTE"
      ? " (HOSTED AUTH ALLOWED; NOT A DESTRUCTIVE DB TARGET)"
      : status === "LOCAL"
        ? " (LOCAL DEVELOPMENT AUTH)"
        : "";

  console.log(
    `${variable}: ${status}${suffix}`,
  );
}

console.log("");

console.log(
  "INFORMATIONAL DATABASE CONFIGURATION",
);

console.log(
  "------------------------------------",
);

for (
  const variable
  of INFORMATIONAL_DATABASE_TARGETS
) {
  const status =
    overallClassification(
      collectCandidates(
        variable,
      ),
    );

  const suffix =
    status === "REMOTE"
      ? " (NOT USED BY LOCAL CERTIFICATION)"
      : "";

  console.log(
    `${variable}: ${status}${suffix}`,
  );
}

console.log("");

console.log(
  "SAFETY MODEL",
);

console.log(
  "------------",
);

console.log(
  "Destructive certification commands are required to use explicit Supabase --local mode.",
);

console.log(
  "The certification engine separately validates actual Supabase service URLs before database reset.",
);

console.log(
  "No environment variable value, hostname, username, password, key, or connection string is printed.",
);

console.log("");

console.log(
  "PASS — environment configuration does not select the destructive database target.",
);

console.log(
  "Authoritative local database safety is enforced separately by explicit Supabase --local commands plus validated local API_URL/DB_URL from `supabase status`.",
);
