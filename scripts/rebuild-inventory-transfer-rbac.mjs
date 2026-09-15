import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRelativePath = "supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql";
const targetPath = path.join(repositoryRoot, targetRelativePath);
const cleanBaselineCommit = "197dccb12f3acde2d6e044558b0ec13081606155";

const canonicalSources = {
  dispatch_stock_request: "supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql",
  receive_stock_request: "supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql",
  create_direct_stock_transfer: "supabase/migrations/20260910140907_direct_store_transfer_lifecycle.sql",
};

const requiredCapabilities = new Map([
  ["transfer_stock", ["inventory.transfer.create", "inventory.transfer.send"]],
  ["create_stock_request", ["inventory.transfer.create"]],
  ["approve_stock_request", ["inventory.transfer.send"]],
  ["start_stock_request_picking", ["inventory.transfer.send"]],
  ["dispatch_stock_request", ["inventory.transfer.send"]],
  ["receive_stock_request", ["inventory.transfer.receive"]],
  ["create_direct_stock_transfer", ["inventory.transfer.create", "inventory.transfer.send"]],
  ["receive_stock_transfer", ["inventory.transfer.receive"]],
]);

function fail(message) {
  throw new Error(`[inventory-transfer-rbac-rebuild] ${message}`);
}

function gitShow(ref, relativePath) {
  try {
    return execFileSync("git", ["show", `${ref}:${relativePath}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim();
    fail(`Unable to read ${relativePath} from ${ref}.${detail ? ` ${detail}` : ""}`);
  }
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function extractFunction(source, schema, functionName) {
  const declaration = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${schema.replaceAll(".", "\\.")}\\.${functionName}\\s*\\(`,
    "i",
  );
  const declarationMatch = declaration.exec(source);
  if (!declarationMatch) fail(`Could not find ${schema}.${functionName}.`);

  const start = declarationMatch.index;
  const tail = source.slice(start);
  const asMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);
  if (!asMatch) fail(`Could not find dollar-quoted body for ${schema}.${functionName}.`);

  const tag = asMatch[1];
  const bodyStart = start + asMatch.index + asMatch[0].length;
  const terminator = `${tag};`;
  const end = source.indexOf(terminator, bodyStart);
  if (end < 0) fail(`Could not find closing ${tag} for ${schema}.${functionName}.`);

  return source.slice(start, end + terminator.length);
}

function replaceLegacyInventoryGuard(functionSource, replacementCondition) {
  const guard = /if\s+\(select\s+auth\.uid\(\)\)\s+is\s+null\s+or\s+not\s+\(select\s+private\.has_permission\(target_organization_id,\s*'inventory\.manage'\)\)\s+then/i;
  const matches = countMatches(functionSource, new RegExp(guard.source, "gi"));
  if (matches !== 1) {
    fail(`Expected exactly one legacy inventory.manage guard, found ${matches}.`);
  }

  return functionSource.replace(guard, replacementCondition);
}

function normalizeCreateOrReplace(functionSource) {
  return functionSource.replace(/^create\s+function/i, "create or replace function");
}

function granularSingle(capability) {
  return `if (select auth.uid()) is null\n     or (\n       not (select private.has_permission(target_organization_id, 'inventory.manage'))\n       and not (select private.has_inventory_capability(target_organization_id, '${capability}'))\n     ) then`;
}

function granularAll(capabilities) {
  const values = capabilities.map((value) => `'${value}'`).join(", ");
  return `if (select auth.uid()) is null\n     or (\n       not (select private.has_permission(target_organization_id, 'inventory.manage'))\n       and not (select private.has_all_inventory_capabilities(\n         target_organization_id,\n         array[${values}]::text[]\n       ))\n     ) then`;
}

function rebuildCanonicalFunction(name, source) {
  let functionSource = normalizeCreateOrReplace(extractFunction(source, "private", name));

  if (name === "dispatch_stock_request") {
    functionSource = replaceLegacyInventoryGuard(
      functionSource,
      granularSingle("inventory.transfer.send"),
    );
  } else if (name === "receive_stock_request") {
    functionSource = replaceLegacyInventoryGuard(
      functionSource,
      granularSingle("inventory.transfer.receive"),
    );
  } else if (name === "create_direct_stock_transfer") {
    functionSource = replaceLegacyInventoryGuard(
      functionSource,
      granularAll(["inventory.transfer.create", "inventory.transfer.send"]),
    );
  } else {
    fail(`No deterministic authorization rewrite is defined for ${name}.`);
  }

  return functionSource.trim();
}

function validateFunctionCapabilities(migration) {
  for (const [name, capabilities] of requiredCapabilities) {
    const declarationCount = countMatches(
      migration,
      new RegExp(`create\\s+or\\s+replace\\s+function\\s+private\\.${name}\\s*\\(`, "gi"),
    );
    if (declarationCount !== 1) {
      fail(`Expected exactly one private.${name} definition, found ${declarationCount}.`);
    }

    const body = extractFunction(migration, "private", name);
    for (const capability of capabilities) {
      if (!body.includes(`'${capability}'`)) {
        fail(`private.${name} is missing ${capability} inside its own function body.`);
      }
    }
  }
}

function validateGeneratedMigration(migration) {
  if (!migration.trimStart().startsWith("-- Phase 6:")) {
    fail("Generated migration does not start from the known Phase 6 clean baseline.");
  }

  const commitCount = countMatches(migration, /^commit;\s*$/gim);
  if (commitCount !== 1) fail(`Expected exactly one top-level COMMIT, found ${commitCount}.`);

  const transactionBeginCount = countMatches(migration, /^begin;\s*$/gim);
  if (transactionBeginCount !== 1) {
    fail(`Expected exactly one top-level BEGIN;, found ${transactionBeginCount}.`);
  }

  for (const forbidden of [
    /tindio\.inventory_required_capabilities/i,
    /pg_get_functiondef\s*\(/i,
    /updated_definition\s*:=\s*replace\s*\(/i,
    /execute\s+updated_definition/i,
    /pg_proc\.prosrc/i,
  ]) {
    if (forbidden.test(migration)) {
      fail(`Generated migration still contains forbidden source-rewrite/capability-routing architecture: ${forbidden}.`);
    }
  }

  validateFunctionCapabilities(migration);

  const orphanPatterns = [
    /^\s*returning\s+id\s+into\s+receipt_id\s*;/im,
    /^\s*for\s+line\s+in\s+select\s+value\s+from\s+jsonb_array_elements\(target_lines\)/im,
  ];

  const scrubbed = migration.replace(/create\s+(?:or\s+replace\s+)?function[\s\S]*?\$\$;/gi, "");
  for (const pattern of orphanPatterns) {
    if (pattern.test(scrubbed)) {
      fail(`Generated migration contains an orphan PL/pgSQL fragment matching ${pattern}.`);
    }
  }
}

async function main() {
  const current = await readFile(targetPath, "utf8");
  if (!current.includes("inventory.transfer.receive")) {
    fail("Current target does not look like the expected granular inventory RBAC migration.");
  }

  const cleanBaseline = gitShow(cleanBaselineCommit, targetRelativePath);
  const cleanCommitCount = countMatches(cleanBaseline, /^commit;\s*$/gim);
  if (cleanCommitCount !== 1) {
    fail(`Clean baseline must contain exactly one COMMIT, found ${cleanCommitCount}.`);
  }

  for (const missingName of [
    "dispatch_stock_request",
    "receive_stock_request",
    "create_direct_stock_transfer",
  ]) {
    const count = countMatches(
      cleanBaseline,
      new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+private\\.${missingName}\\s*\\(`, "gi"),
    );
    if (count !== 0) {
      fail(`Clean baseline unexpectedly already defines private.${missingName}.`);
    }
  }

  const canonicalText = {};
  for (const [name, relativePath] of Object.entries(canonicalSources)) {
    canonicalText[name] = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  }

  const rebuiltFunctions = [
    rebuildCanonicalFunction("dispatch_stock_request", canonicalText.dispatch_stock_request),
    rebuildCanonicalFunction("receive_stock_request", canonicalText.receive_stock_request),
    rebuildCanonicalFunction("create_direct_stock_transfer", canonicalText.create_direct_stock_transfer),
  ];

  const withoutCommit = cleanBaseline.replace(/\ncommit;\s*$/i, "").trimEnd();
  if (withoutCommit === cleanBaseline.trimEnd()) {
    fail("Could not remove the final COMMIT from the clean baseline.");
  }

  const generated = `${withoutCommit}\n\n-- Recovered canonical transfer procedures. Business logic is copied from the\n-- latest complete pre-RBAC definitions; only authorization guards are widened\n-- to accept the explicit granular capability required by each operation.\n\n${rebuiltFunctions.join("\n\n")}\n\ncommit;\n`;

  validateGeneratedMigration(generated);

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "tindio-rbac-rebuild-"));
  const temporaryPath = path.join(temporaryDirectory, path.basename(targetPath));

  try {
    await writeFile(temporaryPath, generated, "utf8");
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  process.stdout.write(
    [
      "Inventory transfer RBAC migration rebuilt successfully.",
      `Baseline: ${cleanBaselineCommit}`,
      `Target: ${targetRelativePath}`,
      "Recovered: dispatch_stock_request, receive_stock_request, create_direct_stock_transfer",
      "No database command was executed.",
      "Next: pnpm test:inventory-rbac && git diff --check",
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
