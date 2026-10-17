import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const startingSha = "e01929308627b7f7842f80e183e3ec2add2af631";
const outputPath = "docs/repository/repository-inventory.json";
const textExtensions = new Set([".css", ".example", ".gitignore", ".js", ".json", ".kt", ".md", ".mjs", ".sql", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml"]);

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const startingFiles = git("ls-tree", "-rz", "--long", startingSha)
  .split("\0")
  .filter(Boolean)
  .map((entry) => {
    const match = entry.match(/^\d+\s+blob\s+[0-9a-f]+\s+(\d+)\t([\s\S]+)$/);
    if (!match) throw new Error(`Unable to parse git tree entry: ${entry}`);
    return { path: match[2], size: Number(match[1]) };
  });

const currentFiles = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
  .split("\0")
  .filter(Boolean);
if (!currentFiles.includes(outputPath)) currentFiles.push(outputPath);
currentFiles.sort();

const readableFiles = currentFiles.filter((file) => {
  if (file === outputPath || !existsSync(path.join(root, file))) return false;
  return textExtensions.has(path.extname(file).toLowerCase()) || ["AGENTS.md", "CLAUDE.md", "README.md"].includes(path.basename(file));
});
const corpus = readableFiles.map((file) => ({ file, content: readFileSync(path.join(root, file), "utf8") }));
const packageJson = readFileSync(path.join(root, "package.json"), "utf8");
const workflows = corpus.filter(({ file }) => file.startsWith(".github/workflows/"));
const documentation = corpus.filter(({ file }) => file.endsWith(".md") || file.endsWith(".txt"));
const runtime = corpus.filter(({ file }) => /\.(?:[cm]?js|tsx?|kt)$/.test(file));

const deletedAssets = new Set([
  "public/file.svg", "public/globe.svg", "public/next.svg", "public/vercel.svg", "public/window.svg",
]);
const compatibilityRoutes = new Set([
  "src/app/api/pos/checkout/route.ts",
  "src/app/api/pos/customer-display/route.ts",
  "src/app/api/pos/customers/route.ts",
  "src/app/api/pos/device/route.ts",
  "src/app/api/pos/offline-checkout/route.ts",
]);

function classify(file) {
  if (deletedAssets.has(file) || file.startsWith("apps/mobile/assets/images/") || file.startsWith("apps/mobile/assets/expo.icon/")) return "DELETE_CANDIDATE";
  if (file.startsWith("plan/")) return "MOVE_SAFE";
  if (file === ".github/workflows/phase-12-certification.yml" || file === ".github/workflows/phase-14-final-certification.yml") return "MERGE_CANDIDATE";
  if (file === "apps/mobile/LICENSE") return "UNKNOWN_REQUIRES_REVIEW";
  if (compatibilityRoutes.has(file)) return "KEEP_COMPATIBILITY";
  if (file.startsWith("apps/store-hub/")) return "KEEP_DEFERRED";
  if (file.startsWith("database/") || file === "docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md" || file === "docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md") return "KEEP_CANONICAL";
  if (file.startsWith("archive/") || file.startsWith("docs/recovery/") || /^docs\/mobile-program\/(?:PHASE|MOB_)/.test(file)) return "KEEP_HISTORICAL";
  return "KEEP_ACTIVE";
}

function owner(file) {
  if (file.startsWith("apps/mobile/")) return "mobile";
  if (file.startsWith("apps/store-hub/")) return "store-hub";
  if (file.startsWith("database/") || file.startsWith("supabase/")) return "database";
  if (file.startsWith("archive/")) return "archive";
  if (file.startsWith("docs/")) return "documentation";
  if (file.startsWith("scripts/")) return "tooling";
  if (file.startsWith("src/app/api/")) return "api";
  if (file.startsWith("src/")) return "web";
  if (file.startsWith(".github/")) return "ci";
  if (file.startsWith(".agents/") || ["AGENTS.md", "CLAUDE.md", "skills-lock.json"].includes(file)) return "agent-tooling";
  return "repository";
}

function lifecycle(category) {
  if (category === "KEEP_DEFERRED") return "deferred";
  if (["KEEP_HISTORICAL", "MOVE_SAFE", "MERGE_CANDIDATE"].includes(category)) return "historical";
  return "active";
}

function countReferences(groups, file) {
  const basename = path.basename(file);
  return groups.reduce((count, entry) => count + (entry.file === file ? 0 : Number(entry.content.includes(file) || entry.content.includes(basename))), 0);
}

const files = startingFiles.map((entry) => {
  const extension = path.extname(entry.path).toLowerCase() || null;
  const category = classify(entry.path);
  return {
    path: entry.path,
    type: extension ? "file" : "configuration",
    size: entry.size,
    extension,
    ownerDomain: owner(entry.path),
    references: {
      runtimeImportOrPath: countReferences(runtime, entry.path),
      packageScript: Number(packageJson.includes(entry.path) || packageJson.includes(path.basename(entry.path))),
      githubWorkflow: countReferences(workflows, entry.path),
      documentation: countReferences(documentation, entry.path),
    },
    generated: entry.path === "pnpm-lock.yaml" || entry.path.endsWith("database.types.ts") || entry.path.includes("/evidence/"),
    lifecycle: lifecycle(category),
    category,
    candidateAction: category,
  };
});

const categoryCounts = Object.fromEntries([...new Set(files.map((file) => file.category))].sort().map((category) => [category, files.filter((file) => file.category === category).length]));
const currentSummary = currentFiles.map((file) => ({
  path: file,
  size: file === outputPath || !existsSync(path.join(root, file)) ? null : statSync(path.join(root, file)).size,
}));

writeFileSync(path.join(root, outputPath), `${JSON.stringify({
  schemaVersion: 1,
  startingSha,
  startingTrackedFileCount: files.length,
  categories: ["KEEP_ACTIVE", "KEEP_CANONICAL", "KEEP_HISTORICAL", "KEEP_COMPATIBILITY", "KEEP_DEFERRED", "MOVE_SAFE", "RENAME_SAFE", "MERGE_CANDIDATE", "DELETE_CANDIDATE", "UNKNOWN_REQUIRES_REVIEW"],
  categoryCounts,
  files,
  currentStructure: currentSummary,
}, null, 2)}\n`);

console.log(`Repository inventory written: ${files.length} starting files, ${currentFiles.length} current files.`);
