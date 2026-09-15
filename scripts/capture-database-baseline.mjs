import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runCommand } from "./lib/run-command.mjs";

const repositoryRoot = process.cwd();
const baselineDirectory = path.join(repositoryRoot, "database", "baseline");
const baselinePath = path.join(baselineDirectory, "0001_tindio_baseline.sql");

const privateSchemaDeclaration = /CREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"private"|private)\b/i;
const privateFunctionDeclaration = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"private"\.|private\.)/i;

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

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasCreateTable(sql, tableName) {
  const identifier = escapeRegex(tableName);

  // pg_dump output varies by version/configuration. A public table may appear as:
  //   CREATE TABLE public.products (...)
  //   CREATE TABLE "public"."products" (...)
  //   CREATE TABLE IF NOT EXISTS public.products (...)
  //   SET search_path = public; CREATE TABLE products (...)
  // The dump is already restricted to public/private, so accepting the
  // unqualified canonical table name is safe here.
  const pattern = new RegExp(
    `CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+` +
      `(?:(?:"public"|public)\\s*\\.\\s*)?` +
      `(?:"${identifier}"|${identifier})(?=\\s|\\()`,
    "i",
  );

  return pattern.test(sql);
}

function summarizeCreateTables(sql) {
  const matches = [
    ...sql.matchAll(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(]+)/gi),
  ].slice(0, 12);

  if (matches.length === 0) return "none found";
  return matches.map((match) => match[1]).join(", ");
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

function normalizeBaselineBootstrap(sql) {
  if (!privateFunctionDeclaration.test(sql)) {
    throw new Error(
      "Baseline dump does not contain private-schema functions. The dump did not capture the complete TINDIO private schema.",
    );
  }

  if (privateSchemaDeclaration.test(sql)) return sql;

  console.log("Baseline dump contains private-schema objects but no explicit CREATE SCHEMA private statement.");
  console.log("Adding the TINDIO-owned private schema bootstrap before the pg_dump output.");

  return [
    "-- TINDIO canonical baseline bootstrap.",
    "-- The historical TINDIO schema explicitly owns the private schema. Some",
    "-- Supabase CLI dump shapes omit the schema-creation statement while still",
    "-- emitting private-schema objects, so make the baseline self-contained.",
    "create schema if not exists private;",
    "revoke all on schema private from public;",
    "",
    sql.trimStart(),
  ].join("\n");
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
  // and Unix worktrees. The only semantic normalization performed here is the
  // explicit private-schema bootstrap when the dump contains private objects
  // but omits CREATE SCHEMA private.
  sql = normalizeBaselineBootstrap(sql.replace(/\r\n/g, "\n"));
  await writeFile(baselinePath, sql, "utf8");

  const forbiddenManagedObjects = [
    /CREATE\s+TABLE\s+(?:"auth"\.|auth\.)/i,
    /CREATE\s+TABLE\s+(?:"storage"\.|storage\.)/i,
    /CREATE\s+TABLE\s+(?:"realtime"\.|realtime\.)/i,
    /CREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"auth"|auth)\b/i,
    /CREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"storage"|storage)\b/i,
    /CREATE\s+SCHEMA(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:"realtime"|realtime)\b/i,
  ];

  for (const pattern of forbiddenManagedObjects) {
    if (pattern.test(sql)) {
      throw new Error(`Baseline unexpectedly contains a provider-managed object matching ${pattern}.`);
    }
  }

  if (!privateSchemaDeclaration.test(sql)) {
    throw new Error("Baseline is missing the TINDIO-owned private schema bootstrap.");
  }

  // Require several stable TINDIO core tables instead of assuming one exact
  // pg_dump qualification/quoting style. This proves the public business schema
  // was captured while remaining portable across pg_dump versions.
  const requiredPublicTables = ["organizations", "stores", "products", "inventory_movements"];
  const missingPublicTables = requiredPublicTables.filter((table) => !hasCreateTable(sql, table));
  if (missingPublicTables.length > 0) {
    throw new Error(
      `Baseline is missing required public TINDIO tables: ${missingPublicTables.join(", ")}. ` +
        `First CREATE TABLE statements seen: ${summarizeCreateTables(sql)}`,
    );
  }

  if (!privateFunctionDeclaration.test(sql)) {
    throw new Error("Baseline is missing TINDIO private functions.");
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
