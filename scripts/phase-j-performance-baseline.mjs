import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const normalize = (path) => path.replaceAll("\\", "/");
const sourcePattern = /\.(?:ts|tsx|js|mjs)$/;

export function collectPerformanceBaseline() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map(normalize);
  const sources = tracked.filter((path) => sourcePattern.test(path));
  const runtimeSources = sources.filter((path) => /^(src|apps\/backend\/src|apps\/mobile\/src)\//.test(path));
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const sourceBytes = (prefix) => sources.filter((path) => path.startsWith(prefix))
    .reduce((total, path) => total + statSync(new URL(`../${path}`, import.meta.url)).size, 0);
  const content = runtimeSources.map(read).join("\n");

  return Object.freeze({
    runtimeSourceFiles: runtimeSources.length,
    webSourceBytes: sourceBytes("src/"),
    backendSourceBytes: sourceBytes("apps/backend/src/"),
    mobileSourceBytes: sourceBytes("apps/mobile/src/"),
    databaseQueryCallsites: (content.match(/\.from\s*\(|\.rpc\s*\(|\bsql\s*`/g) ?? []).length,
    explicitParallelGroups: (content.match(/Promise\.all\s*\(/g) ?? []).length,
    runtimeClientFactories: (content.match(/createClient\s*\(/g) ?? []).length
  });
}

if (process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url))) {
  process.stdout.write(`${JSON.stringify(collectPerformanceBaseline(), null, 2)}\n`);
}
