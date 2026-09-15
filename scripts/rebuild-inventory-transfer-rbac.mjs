import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targetRelativePath = "supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql";
const targetPath = path.join(repositoryRoot, targetRelativePath);

const canonicalSources = {
  transfer_stock: "supabase/migrations/20260821153703_phase_9_advanced_inventory.sql",
  create_stock_request: "supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql",
  approve_stock_request: "supabase/migrations/20260824210000_improvement_14_supply_chain_replenishment.sql",
  start_stock_request_picking: "supabase/migrations/20260824210000_improvement_14_supply_chain_replenishment.sql",
  dispatch_stock_request: "supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql",
  receive_stock_request: "supabase/migrations/20260906074121_transfer_lifecycle_operation_integrity.sql",
  create_direct_stock_transfer: "supabase/migrations/20260910140907_direct_store_transfer_lifecycle.sql",
  receive_stock_transfer: "supabase/migrations/20260910140907_direct_store_transfer_lifecycle.sql",
};

const capabilityMatrix = new Map([
  ["transfer_stock", ["inventory.transfer.create", "inventory.transfer.send"]],
  ["create_stock_request", ["inventory.transfer.create"]],
  ["approve_stock_request", ["inventory.transfer.send"]],
  ["start_stock_request_picking", ["inventory.transfer.send"]],
  ["dispatch_stock_request", ["inventory.transfer.send"]],
  ["receive_stock_request", ["inventory.transfer.receive"]],
  ["create_direct_stock_transfer", ["inventory.transfer.create", "inventory.transfer.send"]],
  ["receive_stock_transfer", ["inventory.transfer.receive"]],
]);

const policyStartMarker = "-- A sender must be able to discover the request";
const reloadStatement = "notify pgrst, 'reload schema';";

function fail(message) {
  throw new Error(`[inventory-transfer-rbac-rebuild] ${message}`);
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function assertNoTruncationArtifacts(source, label) {
  for (const pattern of [
    /tokens?\s+truncated/i,
    /…\s*\d+/u,
    /\.\.\.\s*\d+\s+tokens?\s+truncated/i,
  ]) {
    if (pattern.test(source)) {
      fail(`${label} contains a truncation artifact matching ${pattern}. Refusing to copy incomplete SQL.`);
    }
  }
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

  const block = source.slice(start, end + terminator.length);
  assertNoTruncationArtifacts(block, `${schema}.${functionName}`);
  return block;
}

function removeFunctionBlocks(sql) {
  const declaration = /create\s+(?:or\s+replace\s+)?function\s+[a-zA-Z0-9_.]+\s*\(/gi;
  let cursor = 0;
  let outside = "";

  while (true) {
    declaration.lastIndex = cursor;
    const match = declaration.exec(sql);
    if (!match) {
      outside += sql.slice(cursor);
      break;
    }

    outside += sql.slice(cursor, match.index);
    const tail = sql.slice(match.index);
    const asMatch = /\bas\s+(\$[A-Za-z0-9_]*\$)/i.exec(tail);
    if (!asMatch) fail(`Function beginning at offset ${match.index} has no dollar-quoted AS body.`);

    const tag = asMatch[1];
    const bodyStart = match.index + asMatch.index + asMatch[0].length;
    const end = sql.indexOf(`${tag};`, bodyStart);
    if (end < 0) fail(`Function beginning at offset ${match.index} has no closing ${tag};.`);
    cursor = end + tag.length + 1;
  }

  return outside;
}

function normalizeCreateOrReplace(functionSource) {
  return functionSource.replace(/^create\s+(?:or\s+replace\s+)?function/i, "create or replace function");
}

function replaceLegacyInventoryGuard(functionSource, replacementCondition, functionName) {
  const guard = /if\s+\(select\s+auth\.uid\(\)\)\s+is\s+null\s+or\s+not\s+\(select\s+private\.has_permission\(target_organization_id\s*,\s*'inventory\.manage'\)\)\s+then/i;
  const matches = countMatches(functionSource, new RegExp(guard.source, "gi"));
  if (matches !== 1) {
    fail(`Expected exactly one legacy inventory.manage guard in private.${functionName}; found ${matches}.`);
  }
  return functionSource.replace(guard, replacementCondition);
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
  const capabilities = capabilityMatrix.get(name);
  if (!capabilities) fail(`No capability mapping exists for private.${name}.`);

  const replacement = capabilities.length === 1
    ? granularSingle(capabilities[0])
    : granularAll(capabilities);

  functionSource = replaceLegacyInventoryGuard(functionSource, replacement, name);
  assertNoTruncationArtifacts(functionSource, `rebuilt private.${name}`);
  return functionSource.trim();
}

function extractSafeHeader(current) {
  const firstBusinessFunction = /create\s+(?:or\s+replace\s+)?function\s+private\.transfer_stock\s*\(/i.exec(current);
  if (!firstBusinessFunction) fail("Could not locate the transfer_stock boundary in the existing granular RBAC migration.");

  let header = current.slice(0, firstBusinessFunction.index).trimEnd();
  assertNoTruncationArtifacts(header, "granular RBAC header");

  const staleCommentStart = header.indexOf("-- Existing inventory procedures retain their exact business implementation.");
  const hasPermissionStart = header.indexOf("create or replace function private.has_permission(");
  if (staleCommentStart >= 0 && hasPermissionStart > staleCommentStart) {
    header = `${header.slice(0, staleCommentStart).trimEnd()}\n\n-- Manager approval compatibility remains centralized in has_permission.\n-- Granular inventory capabilities are checked explicitly inside each canonical\n-- inventory procedure; no hidden session capability routing is used.\n${header.slice(hasPermissionStart)}`;
  }

  if (countMatches(header, /^begin;\s*$/gim) !== 1) fail("Granular RBAC header must contain exactly one transaction BEGIN;.");
  if (/^commit;\s*$/im.test(header)) fail("Granular RBAC header unexpectedly contains COMMIT;.");

  for (const expected of [
    "inventory.transfer.create",
    "inventory.transfer.send",
    "inventory.transfer.receive",
    "private.has_inventory_capability",
    "private.has_all_inventory_capabilities",
    "private.has_any_inventory_capability",
    "private.has_permission",
  ]) {
    if (!header.includes(expected)) fail(`Granular RBAC header is missing ${expected}.`);
  }

  return header;
}

function extractSafePolicyBlock(current) {
  const start = current.indexOf(policyStartMarker);
  if (start < 0) fail("Could not locate the transfer read-scope policy block.");

  const reload = current.indexOf(reloadStatement, start);
  if (reload < 0) fail("Could not locate the schema reload statement after the transfer policy block.");

  const block = current.slice(start, reload + reloadStatement.length).trim();
  assertNoTruncationArtifacts(block, "transfer read-scope policy block");

  for (const expected of [
    "private.has_stock_request_read_scope",
    "private.has_stock_transfer_read_scope",
    "stock_requests_select_inventory_transfer_scope",
    "stock_transfers_select_inventory_transfer_scope",
    "stock_transfer_receipts_select_inventory_transfer_scope",
    "supply_chain_warehouses_select_inventory_transfer_scope",
    "private.has_store_read_scope",
  ]) {
    if (!block.includes(expected)) fail(`Transfer read-scope policy block is missing ${expected}.`);
  }

  return block;
}

function validateFunctionCapabilities(migration) {
  for (const [name, capabilities] of capabilityMatrix) {
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
  assertNoTruncationArtifacts(migration, "generated granular transfer RBAC migration");

  if (!migration.trimStart().startsWith("-- Phase 6:")) {
    fail("Generated migration does not start with the expected Phase 6 header.");
  }

  if (countMatches(migration, /^begin;\s*$/gim) !== 1) fail("Generated migration must have exactly one top-level BEGIN;.");
  if (countMatches(migration, /^commit;\s*$/gim) !== 1) fail("Generated migration must have exactly one top-level COMMIT;.");

  for (const forbidden of [
    /tindio\.inventory_required_capabilities/i,
    /pg_get_functiondef\s*\(/i,
    /updated_definition\s*:=\s*replace\s*\(/i,
    /execute\s+updated_definition/i,
    /pg_proc\.prosrc/i,
  ]) {
    if (forbidden.test(migration)) {
      fail(`Generated migration contains forbidden source-rewrite/capability-routing architecture: ${forbidden}.`);
    }
  }

  validateFunctionCapabilities(migration);

  const outsideFunctions = removeFunctionBlocks(migration);
  for (const orphanPattern of [
    /\breceipt_id\s+uuid\s*;/i,
    /\bexisting_receipt\s+public\.stock_transfer_receipts%rowtype\s*;/i,
    /\brequested_payload\s+jsonb\s*;/i,
    /\breturning\s+id\s+into\s+receipt_id\s*;/i,
    /\bfor\s+line\s+in\s+select\s+value\s+from\s+jsonb_array_elements\(target_lines\)/i,
    /\bend\s+if\s*;/i,
    /\bend\s+loop\s*;/i,
  ]) {
    if (orphanPattern.test(outsideFunctions)) {
      fail(`Generated migration contains orphan PL/pgSQL outside a function: ${orphanPattern}.`);
    }
  }
}

function describeMismatch(current, generated) {
  const limit = Math.min(current.length, generated.length);
  let offset = 0;
  while (offset < limit && current[offset] === generated[offset]) offset += 1;
  const line = (value) => value.slice(0, offset).split("\n").length;
  const context = (value) => {
    const lines = value.split("\n");
    const index = line(value) - 1;
    return lines.slice(Math.max(0, index - 3), index + 4).join("\n");
  };
  return [
    `Current normalized length: ${current.length}`,
    `Generated normalized length: ${generated.length}`,
    `First differing character offset: ${offset}`,
    `Current line: ${line(current)}`,
    `Generated line: ${line(generated)}`,
    "CURRENT:", context(current), "GENERATED:", context(generated),
  ].join("\n");
}

async function main() {
  const args = new Set(process.argv.slice(2));
  for (const argument of args) {
    if (argument !== "--check" && argument !== "--write") {
      fail(`Unknown argument: ${argument}. Use --check or --write.`);
    }
  }
  if (args.has("--check") && args.has("--write")) fail("Use either --check or --write, not both.");
  const mode = args.has("--write") ? "write" : "check";
  const current = await readFile(targetPath, "utf8");
  const header = extractSafeHeader(current);
  const policyBlock = extractSafePolicyBlock(current);

  const sourceCache = new Map();
  for (const relativePath of new Set(Object.values(canonicalSources))) {
    const text = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    assertNoTruncationArtifacts(text, relativePath);
    sourceCache.set(relativePath, text);
  }

  const rebuiltFunctions = [];
  for (const name of capabilityMatrix.keys()) {
    rebuiltFunctions.push(
      rebuildCanonicalFunction(name, sourceCache.get(canonicalSources[name])),
    );
  }

  const generated = `${header}\n\n${rebuiltFunctions.join("\n\n")}\n\n${policyBlock}\n\ncommit;\n`;

  validateGeneratedMigration(generated);

  const normalizeNewlines = (value) => value.replace(/\r\n?/g, "\n");
  if (mode === "check") {
    const normalizedCurrent = normalizeNewlines(current);
    const normalizedGenerated = normalizeNewlines(generated);
    if (normalizedCurrent !== normalizedGenerated) {
      fail(`Inventory transfer RBAC migration differs from deterministic source. No file was modified. Use --write only for an intentional recovery after reviewing the mismatch.\n${describeMismatch(normalizedCurrent, normalizedGenerated)}`);
    }
    process.stdout.write("Inventory transfer RBAC migration matches deterministic source.\n");
    return;
  }

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "tindio-rbac-rebuild-"));
  const temporaryPath = path.join(temporaryDirectory, path.basename(targetPath));

  try {
    await writeFile(temporaryPath, generated, "utf8");
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  const written = await readFile(targetPath, "utf8");
  if (normalizeNewlines(written) !== normalizeNewlines(generated)) fail("Written migration does not match deterministic source.");

  process.stdout.write(
    [
      "Historical migration was intentionally regenerated.",
      "Review the complete Git diff before committing.",
      `Target: ${targetRelativePath}`,
      `Recovered canonical procedures: ${[...capabilityMatrix.keys()].join(", ")}`,
      "Historical target migration bodies were NOT used as canonical procedure sources.",
      "Truncation artifacts and orphan PL/pgSQL are rejected before the file is written.",
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
