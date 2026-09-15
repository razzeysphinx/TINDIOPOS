import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [rebuild, verifier, runner] = await Promise.all([
  readFile(new URL("./rebuild-inventory-transfer-rbac.mjs", import.meta.url), "utf8"),
  readFile(new URL("./verify-database-foundation.mjs", import.meta.url), "utf8"),
  readFile(new URL("./lib/run-command.mjs", import.meta.url), "utf8"),
]);

test("recovery tool has explicit safe modes", () => {
  assert.match(rebuild, /--check/);
  assert.match(rebuild, /--write/);
  assert.match(rebuild, /args\.has\("--write"\) \? "write" : "check"/);
});

test("foundation verifier uses shared command runner", () => {
  assert.match(verifier, /\.\/lib\/run-command\.mjs/);
  assert.match(verifier, /runCommand/);
  assert.doesNotMatch(verifier, /spawnSync/);
});

test("verifier uses recovery check mode only", () => {
  assert.match(verifier, /scripts\/rebuild-inventory-transfer-rbac\.mjs", "--check"/);
  assert.doesNotMatch(verifier, /rebuild-inventory-transfer-rbac\.mjs", "--write"/);
});

test("Windows execution remains centralized", () => {
  assert.match(runner, /process\.env\.ComSpec|cmd\.exe/);
});

test("historical target remains exact", () => {
  assert.match(rebuild, /supabase\/migrations\/20260910142940_granular_inventory_transfer_rbac\.sql/);
});

test("recovery checks are byte-stable and read-only", async () => {
  const target = new URL("../supabase/migrations/20260910142940_granular_inventory_transfer_rbac.sql", import.meta.url);
  const before = await readFile(target, "utf8");
  for (let index = 0; index < 2; index += 1) {
    const result = spawnSync(process.execPath, ["scripts/rebuild-inventory-transfer-rbac.mjs", "--check"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(await readFile(target, "utf8"), before);
  }
});
