import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = dirname(CURRENT_FILE);
const ROOT = resolve(SCRIPT_DIRECTORY, "../..");

const SOURCE_ROOTS = ["src"];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const REQUIRED_TARGETS = [
  "src/app/(back-office)/back-office/inventory/page.tsx",
  "src/app/(back-office)/back-office/replenishment/page.tsx",
  "src/features/management/data.ts",
  "src/features/management/service.ts",
  "src/features/pos/data.ts",
  "src/features/pos/service.ts",
  "src/features/catalog/data.ts",
  "src/features/catalog/service.ts",
  "src/features/dashboard/data.ts",
  "src/features/reports/data.ts",
  "src/lib/database/env.ts",
  "src/lib/database/neon-data-api-fetch.ts",
  "src/lib/supabase/pos-v2-database-client.ts",
];

const EVIDENCE_DIRECTORY = resolve(ROOT, "docs/recovery/evidence");
const JSON_OUTPUT = resolve(EVIDENCE_DIRECTORY, "r5-static-db-access.json");
const MARKDOWN_OUTPUT = resolve(EVIDENCE_DIRECTORY, "r5-static-db-access.md");

function git(...args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function normalizePath(value) {
  return value.replaceAll("\\", "/");
}

function walk(relativeDirectory) {
  const absoluteDirectory = resolve(ROOT, relativeDirectory);

  if (!existsSync(absoluteDirectory)) {
    return [];
  }

  const output = [];

  for (const entry of readdirSync(absoluteDirectory)) {
    const absoluteChild = resolve(absoluteDirectory, entry);
    const stats = statSync(absoluteChild);

    if (stats.isDirectory()) {
      const childRelative = normalizePath(relative(ROOT, absoluteChild));

      if (
        childRelative.includes("/node_modules/")
        || childRelative.includes("/.next/")
        || childRelative.includes("/dist/")
        || childRelative.includes("/coverage/")
      ) {
        continue;
      }

      output.push(...walk(childRelative));
      continue;
    }

    if (SOURCE_EXTENSIONS.has(extname(entry))) {
      output.push(absoluteChild);
    }
  }

  return output;
}

function countMatches(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function classifyDomain(file) {
  if (file.includes("/back-office/replenishment/")) {
    return "replenishment";
  }

  if (
    file === "src/app/(back-office)/back-office/inventory/page.tsx"
    || file.includes("/features/inventory/")
    || file.includes("/api/inventory/")
  ) {
    return "inventory";
  }

  if (file.includes("/features/management/")) {
    return "management";
  }

  if (file.includes("/features/catalog/") || file.includes("/api/catalog/")) {
    return "catalog";
  }

  if (
    file.includes("/features/pos/")
    || file.includes("/api/pos/")
    || file.includes("/app/(pos)/")
  ) {
    return "pos";
  }

  if (file.includes("/features/dashboard/")) {
    return "dashboard";
  }

  if (file.includes("/features/reports/")) {
    return "reports";
  }

  if (file.includes("/lib/database/") || file.includes("/lib/supabase/")) {
    return "database-boundary";
  }

  return "other";
}

function inspectFile(absoluteFile) {
  const file = normalizePath(relative(ROOT, absoluteFile));
  const source = readFileSync(absoluteFile, "utf8");
  const fromCalls = countMatches(source, /\.from\s*\(/g);
  const rpcCalls = countMatches(source, /\.rpc\s*\(/g);
  const createClientCalls = countMatches(source, /\bcreateClient\s*\(/g);
  const posDatabaseClientCalls = countMatches(
    source,
    /\bcreatePosV2DatabaseClient\s*\(/g,
  );
  const supabaseServerImports = countMatches(source, /@\/lib\/supabase\/server/g);
  const directSupabaseJsImports = countMatches(
    source,
    /from\s+["']@supabase\/supabase-js["']/g,
  );

  return {
    file,
    domain: classifyDomain(file),
    from_calls: fromCalls,
    rpc_calls: rpcCalls,
    db_call_sites: fromCalls + rpcCalls,
    create_client_calls: createClientCalls,
    pos_database_client_calls: posDatabaseClientCalls,
    supabase_server_imports: supabaseServerImports,
    direct_supabase_js_imports: directSupabaseJsImports,
  };
}

function emptyDomain(domain) {
  return {
    domain,
    files: 0,
    files_with_db_calls: 0,
    from_calls: 0,
    rpc_calls: 0,
    db_call_sites: 0,
    create_client_calls: 0,
    pos_database_client_calls: 0,
    supabase_server_imports: 0,
    direct_supabase_js_imports: 0,
  };
}

const branch = git("branch", "--show-current");
const head = git("rev-parse", "HEAD");
const sourceFiles = SOURCE_ROOTS.flatMap((root) => walk(root));
const rows = sourceFiles.map(inspectFile);
const domainMap = new Map();

for (const row of rows) {
  const current = domainMap.get(row.domain) ?? emptyDomain(row.domain);

  current.files += 1;
  if (row.db_call_sites > 0) {
    current.files_with_db_calls += 1;
  }
  current.from_calls += row.from_calls;
  current.rpc_calls += row.rpc_calls;
  current.db_call_sites += row.db_call_sites;
  current.create_client_calls += row.create_client_calls;
  current.pos_database_client_calls += row.pos_database_client_calls;
  current.supabase_server_imports += row.supabase_server_imports;
  current.direct_supabase_js_imports += row.direct_supabase_js_imports;
  domainMap.set(row.domain, current);
}

const missingTargets = REQUIRED_TARGETS.filter(
  (file) => !existsSync(resolve(ROOT, file)),
);
const targetFiles = REQUIRED_TARGETS
  .filter((file) => existsSync(resolve(ROOT, file)))
  .map((file) => inspectFile(resolve(ROOT, file)));
const topFiles = rows
  .filter(
    (row) =>
      row.db_call_sites > 0
      || row.create_client_calls > 0
      || row.pos_database_client_calls > 0,
  )
  .sort((left, right) => {
    if (right.db_call_sites !== left.db_call_sites) {
      return right.db_call_sites - left.db_call_sites;
    }
    return left.file.localeCompare(right.file);
  })
  .slice(0, 100);

const totals = rows.reduce(
  (result, row) => {
    result.files += 1;
    if (row.db_call_sites > 0) {
      result.files_with_db_calls += 1;
    }
    result.from_calls += row.from_calls;
    result.rpc_calls += row.rpc_calls;
    result.db_call_sites += row.db_call_sites;
    result.create_client_calls += row.create_client_calls;
    result.pos_database_client_calls += row.pos_database_client_calls;
    result.supabase_server_imports += row.supabase_server_imports;
    result.direct_supabase_js_imports += row.direct_supabase_js_imports;
    return result;
  },
  emptyDomain(undefined),
);
delete totals.domain;

const domains = Array.from(domainMap.values()).sort(
  (left, right) => right.db_call_sites - left.db_call_sites,
);

const report = {
  schema_version: 1,
  recovery_phase: "R5",
  slice: "R5-S1",
  purpose: "Static database-access baseline before R5 performance rewrites",
  branch,
  head,
  source_roots: SOURCE_ROOTS,
  missing_required_targets: missingTargets,
  totals,
  domains,
  required_target_files: targetFiles,
  top_files: topFiles,
};

mkdirSync(EVIDENCE_DIRECTORY, { recursive: true });
writeFileSync(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  "# TINDIO R5 Static Database Access Baseline",
  "",
  `Branch: \`${branch}\``,
  "",
  `HEAD: \`${head}\``,
  "",
  "## Totals",
  "",
  "```json",
  JSON.stringify(totals, null, 2),
  "```",
  "",
  "## Domain totals",
  "",
  "| Domain | Files with DB calls | .from() | .rpc() | Static DB call sites |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...domains.map(
    (domain) => `| ${domain.domain} | ${domain.files_with_db_calls} | ${domain.from_calls} | ${domain.rpc_calls} | ${domain.db_call_sites} |`,
  ),
  "",
  "## Required R5 target files",
  "",
  "| File | Domain | .from() | .rpc() | Static DB call sites |",
  "| --- | --- | ---: | ---: | ---: |",
  ...targetFiles.map(
    (row) => `| \`${row.file}\` | ${row.domain} | ${row.from_calls} | ${row.rpc_calls} | ${row.db_call_sites} |`,
  ),
  "",
  "## Highest static DB fan-out files",
  "",
  "| File | Domain | DB call sites | .from() | .rpc() |",
  "| --- | --- | ---: | ---: | ---: |",
  ...topFiles.map(
    (row) => `| \`${row.file}\` | ${row.domain} | ${row.db_call_sites} | ${row.from_calls} | ${row.rpc_calls} |`,
  ),
  "",
  "## Missing required targets",
  "",
  missingTargets.length > 0
    ? missingTargets.map((file) => `- \`${file}\``).join("\n")
    : "None.",
  "",
  "## Interpretation",
  "",
  "This is static source evidence.",
  "",
  "It measures source-level database call sites and database-client usage.",
  "",
  "It does NOT by itself prove runtime latency, query execution count, DB CPU cost, or production request latency.",
  "",
  "Those measurements remain required during later R5 slices and R5 final certification.",
  "",
].join("\n");

writeFileSync(MARKDOWN_OUTPUT, markdown);

console.log(
  JSON.stringify(
    {
      phase: report.recovery_phase,
      slice: report.slice,
      branch: report.branch,
      head: report.head,
      missing_required_targets: report.missing_required_targets,
      totals: report.totals,
      domains: report.domains,
      required_target_files: report.required_target_files,
      top_15: report.top_files.slice(0, 15),
      evidence: {
        json: normalizePath(relative(ROOT, JSON_OUTPUT)),
        markdown: normalizePath(relative(ROOT, MARKDOWN_OUTPUT)),
      },
    },
    null,
    2,
  ),
);

if (missingTargets.length > 0) {
  process.exitCode = 1;
}
