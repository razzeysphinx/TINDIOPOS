import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { runCommand } from "../../lib/run-command.mjs";
import { runReadOnlySql } from "../../lib/phase-04-postgres-docker.mjs";

export const SOURCE = Object.freeze({
  projectId: "noisy-violet-27747237",
  branchName: "tindio-preproduction-phase-04",
  database: "neondb",
  host: "ep-steep-bonus-ay5df74y.c-5.us-east-2.aws.neon.tech",
});

export const TARGET = Object.freeze({
  projectId: "divine-sound-41148108",
  projectName: "TINDIO R6 RECOVERY 2026-10-02",
  branchId: "br-snowy-heart-b5nf6q3n",
  branchName: "r6-clean-canonical-20261002",
  database: "tindio_r6_recovery",
  ownerRole: "tindio_r6_recovery_owner",
  host: "ep-wandering-voice-b5w9m9db.c-7.us-east-2.aws.neon.tech",
});

function neon(args) {
  const executable = process.platform === "win32"
    ? process.env.ComSpec || "cmd.exe"
    : "neon";
  const commandArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", ["neon", ...args].join(" ")]
    : args;
  const result = runCommand(executable, commandArgs, {
    cwd: process.cwd(), env: process.env, capture: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error(String(result.stderr || `neon ${args.join(" ")} failed`));
  }
  return String(result.stdout ?? "").trim();
}

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/u).flatMap((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) return [];
    return [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/u, "$2")]];
  }));
}

function assertDirectNeonUrl(value, expected, label) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:", `${label} must use PostgreSQL.`);
  assert.equal(parsed.hostname, expected.host, `${label} host is not approved.`);
  assert.equal(parsed.pathname.slice(1), expected.database, `${label} database is not approved.`);
  assert.ok(!parsed.hostname.includes("-pooler"), `${label} must be direct/unpooled.`);
  return value;
}

export async function sourceUrl() {
  const explicit = process.env.TINDIO_CANONICAL_SOURCE_DATABASE_URL
    ?? process.env.TINDIO_R7_SOURCE_DATABASE_URL;
  const env = explicit ? {} : parseEnv(await readFile(".env.local", "utf8"));
  return assertDirectNeonUrl(explicit || env.DATABASE_URL_UNPOOLED, SOURCE, "R7 source");
}

export function targetUrl() {
  const explicit = process.env.TINDIO_CANONICAL_TARGET_DATABASE_URL
    ?? process.env.TINDIO_R7_TARGET_DATABASE_URL;

  if (explicit) {
    return assertDirectNeonUrl(explicit, TARGET, "R7 target");
  }

  const projects = JSON.parse(neon(["projects", "list", "-o", "json"]));
  assert.ok(projects.some((item) => item.id === TARGET.projectId && item.name === TARGET.projectName), "R7 target project mismatch.");
  const branches = JSON.parse(neon(["branches", "list", "--project-id", TARGET.projectId, "-o", "json"]));
  assert.ok(branches.some((item) => item.id === TARGET.branchId && item.name === TARGET.branchName), "R7 target branch mismatch.");
  const databases = JSON.parse(neon(["databases", "list", "--project-id", TARGET.projectId, "-o", "json"]));
  assert.ok(databases.some((item) => item.name === TARGET.database), "R7 target database mismatch.");
  const value = neon(["connection-string", TARGET.branchName, "--project-id", TARGET.projectId, "--database-name", TARGET.database, "--role-name", TARGET.ownerRole, "--ssl", "require"]);
  return assertDirectNeonUrl(value, TARGET, "R7 target");
}

export function identity(url) {
  return JSON.parse(runReadOnlySql(url, `
    select jsonb_build_object(
      'database', current_database(),
      'user', current_user,
      'readOnly', current_setting('transaction_read_only')::boolean,
      'publicTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p')),
      'privateTables', (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind in ('r','p'))
    )::text;
  `));
}

export function sanitizedIdentity(expected, actual) {
  return {
    projectId: expected.projectId,
    branchId: expected.branchId,
    branchName: expected.branchName,
    database: actual.database,
    user: actual.user,
    host: expected.host.replace(/^([^.]+).*/u, "$1.…neon.tech"),
    readOnly: actual.readOnly,
    publicTables: actual.publicTables,
    privateTables: actual.privateTables,
  };
}

export function readJson(url, sql) {
  return JSON.parse(runReadOnlySql(url, `${sql.trim().replace(/;$/u, "")}::text;`));
}

export function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
