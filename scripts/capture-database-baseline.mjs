import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runCommand } from "./lib/run-command.mjs";

const repositoryRoot = process.cwd();
const baselineDirectory = path.join(repositoryRoot, "database", "baseline");
const baselinePath = path.join(baselineDirectory, "0001_tindio_baseline.sql");

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = runCommand(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    capture: options.capture,
    encoding: options.encoding ?? "utf8",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result;
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function summarizeBaseline(sql) {
  const findings = {
    authUid: countMatches(sql, /\bauth\.uid\s*\(\s*\)/g),
    providerRoles: countMatches(sql, /\b(?:anon|authenticated|service_role)\b/g),
    pgrstReload: countMatches(sql, /notify\s+pgrst|pgrst\.reload_schema/gi),
    authSchema: countMatches(sql, /\bauth\./g),
    storageSchema: countMatches(sql, /\bstorage\./g),
    realtimeSchema: countMatches(sql, /\brealtime\./g),
  };

  console.log("\nBaseline portability inventory");
  console.log("------------------------------");
  console.log(`auth.uid() references: ${findings.authUid}`);
  console.log(`provider-role references: ${findings.providerRoles}`);
  console.log(`PostgREST reload references: ${findings.pgrstReload}`);
  console.log(`auth schema references: ${findings.authSchema}`);
  console.log(`storage schema references: ${findings.storageSchema}`);
  console.log(`realtime schema references: ${findings.realtimeSchema}`);
  console.log("");
  console.log("These counts are expected to be non-zero at the R2 snapshot stage.");
  console.log("R3/R4 remove provider identity and role coupling before plain PostgreSQL/Neon certification.");
}

async function main() {
  console.log("TINDIO canonical database baseline capture");
  console.log("=========================================");
  console.log("Source: LOCAL Supabase/PostgreSQL only");
  console.log("Schemas: public, private");
  console.log("No linked or remote database command is used by this script.\n");

  await mkdir(baselineDirectory, { recursive: true });

  // Prove the local database can still be recreated before freezing its schema.
  run("pnpm", ["exec", "supabase", "db", "reset", "--local"]);

  // Supabase CLI db dump uses pg_dump and excludes Supabase-managed schemas by
  // default. Restricting to public/private makes the baseline explicitly
  // TINDIO-owned while the later portability phases remove remaining provider
  // identity/role references inside those schemas.
  run("pnpm", [
    "exec",
    "supabase",
    "db",
    "dump",
    "--local",
    "--schema",
    "public,private",
    "--file",
    path.relative(repositoryRoot, baselinePath).replaceAll("\\", "/"),
    "--keep-comments",
  ]);

  let sql = await readFile(baselinePath, "utf8");
  if (!sql.trim()) throw new Error("Baseline dump is empty.");

  // Normalize line endings so the generated baseline is stable across Windows
  // and Unix worktrees. Do not rewrite SQL semantics here.
  sql = sql.replace(/\r\n/g, "\n");
  await writeFile(baselinePath, sql, "utf8");

  const forbiddenManagedObjects = [
    /CREATE\s+TABLE\s+auth\./i,
    /CREATE\s+TABLE\s+storage\./i,
    /CREATE\s+TABLE\s+realtime\./i,
    /CREATE\s+SCHEMA\s+auth\b/i,
    /CREATE\s+SCHEMA\s+storage\b/i,
    /CREATE\s+SCHEMA\s+realtime\b/i,
  ];

  for (const pattern of forbiddenManagedObjects) {
    if (pattern.test(sql)) {
      throw new Error(`Baseline unexpectedly contains a provider-managed object matching ${pattern}.`);
    }
  }

  for (const required of [
    /CREATE\s+SCHEMA\s+private\b/i,
    /CREATE\s+TABLE\s+public\./i,
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+private\./i,
  ]) {
    if (!required.test(sql)) {
      throw new Error(`Baseline is missing expected TINDIO database content matching ${required}.`);
    }
  }

  summarizeBaseline(sql);

  console.log(`Baseline written to: ${path.relative(repositoryRoot, baselinePath).replaceAll("\\", "/")}`);
  console.log("\nNEXT:");
  console.log("  1. git diff -- database/baseline/0001_tindio_baseline.sql");
  console.log("  2. node scripts/database-portability-audit.mjs");
  console.log("  3. Do NOT archive legacy migrations yet.");
  console.log("  4. Continue R3: provider-neutral identity boundary.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
