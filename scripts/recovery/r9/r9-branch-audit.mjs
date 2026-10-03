import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const recovery = "origin/recovery/neon-canonical-rebuild";
const defaultBranch = "origin/TINDIO-PREPRODUCTION";
const output = "docs/recovery/evidence/r9/r9-branch-audit.json";

function git(...args) {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" }).trim();
}

const branches = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
  .split(/\r?\n/u)
  .filter((branch) => branch && !["origin", recovery, defaultBranch].includes(branch));

const entries = branches.map((branch) => {
  const [behindRecovery, aheadOfRecovery] = git("rev-list", "--left-right", "--count", `${recovery}...${branch}`)
    .split(/\s+/u)
    .map(Number);
  const uniqueCommits = git("log", "--format=%H %s", `${recovery}..${branch}`)
    .split(/\r?\n/u)
    .filter(Boolean);

  return {
    branch: branch.replace(/^origin\//u, ""),
    aheadOfRecovery,
    behindRecovery,
    uniqueCommits,
    classification: uniqueCommits.length === 0 ? "FULLY_CONTAINED" : "HAS_UNIQUE_WORK",
  };
});

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  comparedTo: { defaultBranch, recovery },
  branches: entries,
  summary: {
    audited: entries.length,
    fullyContained: entries.filter(({ classification }) => classification === "FULLY_CONTAINED").length,
    uniqueWork: entries.filter(({ classification }) => classification === "HAS_UNIQUE_WORK").length,
    deleted: 0,
  },
}, null, 2)}\n`, "utf8");

console.log(`R9 branch audit: ${entries.length} branches audited.`);
