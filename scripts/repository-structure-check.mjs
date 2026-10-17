import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), "utf8");
const tracked = () => execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean);

function markdownTargets(source) {
  const targets = [];
  for (let start = source.indexOf("]("); start >= 0; start = source.indexOf("](", start + 2)) {
    let depth = 1;
    let end = start + 2;
    for (; end < source.length && depth > 0; end += 1) {
      if (source[end] === "(") depth += 1;
      if (source[end] === ")") depth -= 1;
    }
    if (depth === 0) targets.push(source.slice(start + 2, end - 1));
  }
  return targets;
}

test("canonical repository boundaries remain present", () => {
  for (const required of [
    "database/baseline/0001_tindio_baseline.sql",
    "database/baseline/0001_tindio_baseline.manifest.json",
    "database/migrations",
    "database/provider/local",
    "database/provider/neon",
    "archive/database/supabase-migrations.manifest.json",
    "docs/TINDIO_MOBILE_NEON_SOURCE_OF_TRUTH.md",
    "docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md",
    "apps/store-hub",
    "neon.ts",
    "hello.ts",
  ]) assert.ok(existsSync(path.join(root, required)), `Missing canonical path: ${required}`);
});

test("package script file targets resolve", () => {
  const scripts = JSON.parse(read("package.json")).scripts ?? {};
  const missing = [];
  for (const [name, command] of Object.entries(scripts)) {
    for (const match of command.matchAll(/(?:node|tsx|ts-node)\s+([^\s;&|]+)/g)) {
      const target = match[1].replace(/^['"]|['"]$/g, "");
      if (!target.startsWith("-") && !target.includes("$") && !existsSync(path.join(root, target))) missing.push(`${name}: ${target}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("canonical migration history and provider split remain intact", () => {
  const files = tracked();
  const migrations = files.filter((file) => file.startsWith("database/migrations/"));
  assert.deepEqual(migrations.map((file) => path.basename(file).slice(0, 4)), migrations.map((_, index) => String(index + 2).padStart(4, "0")));
  assert.equal(files.some((file) => file.startsWith("supabase/migrations/")), false);
  assert.ok(files.some((file) => file.startsWith("archive/database/supabase-migrations/")));
});

test("starter assets and starter mobile instructions do not return", () => {
  const files = new Set(tracked());
  for (const file of ["public/file.svg", "public/globe.svg", "public/next.svg", "public/vercel.svg", "public/window.svg"]) assert.equal(files.has(file), false, `${file} must stay removed`);
  const mobileReadme = read("apps/mobile/README.md");
  assert.doesNotMatch(mobileReadme, /Welcome to your Expo app|create-expo-app|reset-project/);
  assert.match(mobileReadme, /com\.tindio\.pos/);
});

test("workflow and compatibility policy remain documented", () => {
  const workflows = tracked().filter((file) => file.startsWith(".github/workflows/"));
  assert.deepEqual(workflows, [".github/workflows/tindio-baseline-certification.yml"]);
  const workflow = read(workflows[0]);
  assert.doesNotMatch(workflow, /recovery\/phase-(?:12|14)/);
  for (const marker of ["composite-production-concurrency-certification.mjs", "phase-14-migration-rehearsal.mjs", "phase-14-local-restore-drill.mjs", "certify:phase-02:bearer-auth", "git diff --check"]) assert.match(workflow, new RegExp(marker.replaceAll(".", "\\.")));
  const apiReadme = read("src/app/api/pos/README.md");
  assert.match(apiReadme, /KEEP_COMPATIBILITY/);
  for (const route of ["checkout", "customer-display", "customers", "device", "offline-checkout"]) assert.ok(existsSync(path.join(root, `src/app/api/pos/${route}/route.ts`)));
});

test("tracked files exclude common secrets and release artifacts", () => {
  const unsafe = tracked().filter((file) => /(^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:pem|key|keystore|jks|apk|aab))$/i.test(file));
  assert.deepEqual(unsafe, []);
});

test("relative Markdown links resolve", () => {
  const failures = [];
  for (const file of tracked().filter((candidate) => candidate.endsWith(".md"))) {
    for (let target of markdownTargets(read(file))) {
      target = target.trim().replace(/^<|>$/g, "").split("#")[0];
      if (!target || /^[a-z]+:/i.test(target)) continue;
      const resolved = path.resolve(root, path.dirname(file), decodeURIComponent(target));
      if (!existsSync(resolved)) failures.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(failures, []);
});
