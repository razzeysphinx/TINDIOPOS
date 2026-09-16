import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");

const EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const CURRENT_INVENTORY_RPCS = new Set([
  "create_inventory_count_plan_v2",
  "save_inventory_count_line_v2",
  "create_purchase_order_v2",
  "record_inventory_adjustment_v3",
  "upsert_inventory_replenishment_rule_v2",
]);

const RETIRED_INVENTORY_RPCS = new Set([
  "create_inventory_count_plan",
  "save_inventory_count_line",
  "create_purchase_order",
  "record_inventory_adjustment",
  "record_inventory_adjustment_v2",
  "upsert_inventory_replenishment_rule",
  "complete_inventory_count",
  "create_inventory_count_draft",
]);

const RETIRED_EXACT_SIGNATURE_SENSITIVE_RPCS = new Set([
  "post_inventory_count",
]);

async function walk(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  });

  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
      continue;
    }

    if (
      entry.isFile()
      && EXTENSIONS.has(path.extname(entry.name))
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractRpcCalls(source) {
  const calls = [];

  const pattern =
    /\.rpc\s*\(\s*(["'])([A-Za-z0-9_]+)\1\s*(?:,|\))/g;

  for (const match of source.matchAll(pattern)) {
    calls.push({
      name: match[2],
      index: match.index ?? 0,
    });
  }

  return calls;
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function normalizePath(filePath) {
  return path
    .relative(ROOT, filePath)
    .split(path.sep)
    .join("/");
}

const files = await walk(SRC_ROOT);

const retiredCallers = [];
const currentCallers = [];
const exactSensitiveCallers = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  const calls = extractRpcCalls(source);

  for (const call of calls) {
    const location = {
      file: normalizePath(file),
      line: lineNumberAt(source, call.index),
      name: call.name,
    };

    if (CURRENT_INVENTORY_RPCS.has(call.name)) {
      currentCallers.push(location);
    }

    if (RETIRED_INVENTORY_RPCS.has(call.name)) {
      retiredCallers.push(location);
    }

    if (RETIRED_EXACT_SIGNATURE_SENSITIVE_RPCS.has(call.name)) {
      exactSensitiveCallers.push(location);
    }
  }
}

console.log("CURRENT RPC CONTRACT COHERENCE");
console.log("------------------------------");
console.log(`scanned files: ${files.length}`);
console.log(
  `current inventory RPC callers: ${currentCallers.length}`,
);
console.log(
  `retired inventory RPC callers: ${retiredCallers.length}`,
);

if (retiredCallers.length > 0) {
  console.error("");
  console.error(
    "FAIL: retired inventory RPC callers remain in src/.",
  );

  for (const caller of retiredCallers) {
    console.error(
      `- ${caller.file}:${caller.line} -> ${caller.name}`,
    );
  }

  process.exit(1);
}

/*
 * post_inventory_count is intentionally NOT treated as universally
 * retired because the hardened public API retains the canonical
 * three-argument operation-ID form.
 *
 * This scanner cannot reliably determine SQL/PostgREST arity from
 * arbitrary TypeScript object formatting, so its existence is reported
 * rather than rejected here. The dedicated inventory RPC contract test
 * remains authoritative for its exact contract.
 */
if (exactSensitiveCallers.length > 0) {
  console.log(
    `post_inventory_count callers requiring dedicated contract validation: ${exactSensitiveCallers.length}`,
  );
}

console.log("PASS");
