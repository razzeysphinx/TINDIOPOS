import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const manifestArgument = process.argv[2];
if (!manifestArgument) {
  console.error("Usage: node scripts/recovery/phase-contract-check.mjs <manifest.json>");
  process.exit(2);
}

const root = process.cwd();
const manifestPath = path.resolve(root, manifestArgument);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const failures = [];

for (const relativePath of manifest.requiredPaths ?? []) {
  try {
    await access(path.resolve(root, relativePath));
  } catch {
    failures.push(`missing required path: ${relativePath}`);
  }
}

async function checkText(entry, forbidden) {
  const content = await readFile(path.resolve(root, entry.path), "utf8");
  const matched = entry.text !== undefined
    ? content.includes(entry.text)
    : new RegExp(entry.pattern, entry.flags ?? "m").test(content);
  if (forbidden ? matched : !matched) {
    failures.push(`${forbidden ? "forbidden" : "required"} semantic ${forbidden ? "present" : "missing"}: ${entry.path} :: ${entry.text ?? entry.pattern}`);
  }
}

for (const entry of manifest.requiredText ?? []) await checkText(entry, false);
for (const entry of manifest.forbiddenText ?? []) await checkText(entry, true);

console.log(`Phase ${manifest.phase}: ${manifest.requiredPaths?.length ?? 0} paths, ${manifest.requiredText?.length ?? 0} required semantics, ${manifest.forbiddenText?.length ?? 0} forbidden semantics.`);
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("CONTROLLER CONTRACT: PASS");
