import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("J3 documents every canonical source root", async () => {
  const [decision, guide] = await Promise.all([
    read("docs/architecture/TINDIO_PHASE_J3_DIRECTORY_CLEANUP.json").then(JSON.parse),
    read("docs/repository/PHASE_J_DIRECTORY_OWNERSHIP.md")
  ]);
  for (const directory of decision.canonicalRoots) assert.equal(guide.includes("| `" + directory + "/` |"), true);
  assert.deepEqual(decision.sourceDirectoriesMoved, []);
  assert.equal(decision.historicalEvidenceDeleted, false);
});

test("J3 ignores local Phase J workspace outputs", async () => {
  const gitignore = await read(".gitignore");
  for (const path of ["/.tmp/", "/.tmp-adb-home/", "/.tmp-android-user/", "/.pnpm-store/"]) {
    assert.equal(gitignore.includes(path), true);
  }
});

test("J3 keeps generated build/test directories out of tracked source", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: new URL("../", import.meta.url), encoding: "utf8" });
  assert.doesNotMatch(tracked, /(^|\/)(?:\.next|coverage|test-results|playwright-report|dist|build)\//m);
});

test("J3 retains intentional Neon infrastructure adjacency", async () => {
  const [config, handler] = await Promise.all([read("neon.ts"), read("hello.ts")]);
  assert.match(config, /source:\s*"\.\/hello\.ts"/);
  assert.match(handler, /Hello from Neon Functions/);
});
