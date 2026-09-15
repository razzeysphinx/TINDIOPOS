import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const roots = ["src", "supabase/migrations"];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".sql"]);

const categories = [
  {
    name: "supabase-auth-runtime",
    pattern: /\.auth\.(?:signInWithPassword|signUp|signOut|getUser|getSession|exchangeCodeForSession)\b/g,
  },
  {
    name: "supabase-browser-server-client",
    pattern: /create(?:Browser|Server)Client\b/g,
  },
  {
    name: "supabase-realtime",
    pattern: /\.channel\s*\(|postgres_changes|broadcast|presence/g,
  },
  {
    name: "supabase-postgrest-rpc",
    pattern: /\.rpc\s*\(/g,
  },
  {
    name: "supabase-postgrest-query",
    pattern: /\.from\s*\(/g,
  },
  {
    name: "supabase-database-identity",
    pattern: /\bauth\.uid\s*\(\s*\)/g,
  },
  {
    name: "supabase-database-role",
    pattern: /\b(?:authenticated|anon|service_role)\b/g,
  },
  {
    name: "postgrest-schema-reload",
    pattern: /notify\s+pgrst|pgrst\.reload_schema/gi,
  },
  {
    name: "supabase-schema-reference",
    pattern: /\bauth\.users\b|\bstorage\.|\brealtime\./g,
  },
];

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(repositoryRoot, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(relativePath));
    else if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(relativePath);
  }

  return files;
}

function lineNumberAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source.charCodeAt(index) === 10) line += 1;
  }
  return line;
}

const findings = [];

for (const root of roots) {
  for (const relativePath of await walk(root)) {
    const source = await readFile(path.join(repositoryRoot, relativePath), "utf8");

    for (const category of categories) {
      category.pattern.lastIndex = 0;
      for (const match of source.matchAll(category.pattern)) {
        findings.push({
          category: category.name,
          file: relativePath.replaceAll("\\", "/"),
          line: lineNumberAt(source, match.index ?? 0),
          token: match[0],
        });
      }
    }
  }
}

const grouped = new Map();
for (const finding of findings) {
  if (!grouped.has(finding.category)) grouped.set(finding.category, []);
  grouped.get(finding.category).push(finding);
}

console.log("TINDIO DATABASE PORTABILITY AUDIT");
console.log("=================================");
console.log(`Files scanned roots: ${roots.join(", ")}`);
console.log(`Provider-coupling findings: ${findings.length}`);
console.log("");

for (const category of categories) {
  const categoryFindings = grouped.get(category.name) ?? [];
  console.log(`${category.name}: ${categoryFindings.length}`);
  for (const finding of categoryFindings.slice(0, 20)) {
    console.log(`  ${finding.file}:${finding.line}  ${finding.token}`);
  }
  if (categoryFindings.length > 20) {
    console.log(`  ... ${categoryFindings.length - 20} more`);
  }
  console.log("");
}

console.log("This audit is informational during the rebuild. It intentionally does not fail while legacy Supabase coupling remains.");
