import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(CURRENT_FILE), "../..");
const AUDIT_SCRIPT = resolve(
  ROOT,
  "scripts/recovery/neon-recovery-r5-static-access-audit.mjs",
);
const REPORT_FILE = resolve(ROOT, "docs/recovery/evidence/r5-static-db-access.json");
const SOURCE_OF_TRUTH = resolve(
  ROOT,
  "docs/recovery/TINDIO_NEON_RECOVERY_SOURCE_OF_TRUTH.md",
);

function git(...args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function refreshReport() {
  execFileSync(process.execPath, [AUDIT_SCRIPT], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
  });
}

test("R5 static database-access evidence is reproducible", () => {
  refreshReport();

  const report = JSON.parse(readFileSync(REPORT_FILE, "utf8"));

  assert.equal(report.recovery_phase, "R5");
  assert.equal(report.slice, "R5-S1");
  assert.equal(report.branch, "recovery/neon-canonical-rebuild");
  assert.equal(report.head, git("rev-parse", "HEAD"));
  assert.deepEqual(report.missing_required_targets, []);
  assert.ok(report.totals.files > 0);
  assert.ok(report.totals.files_with_db_calls > 0);
  assert.ok(report.totals.db_call_sites > 0);

  const requiredFiles = new Map(
    report.required_target_files.map((item) => [item.file, item]),
  );
  const expected = [
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
  ];

  for (const requiredFile of expected) {
    assert.ok(requiredFiles.has(requiredFile), `Missing R5 hotspot: ${requiredFile}`);
  }
});

test("R5 audit keeps the locked recovery program intact", () => {
  const source = readFileSync(SOURCE_OF_TRUTH, "utf8").replace(/\r\n/g, "\n");

  assert.ok(source.includes("R4"), "Recovery SoT must retain R4.");
  assert.ok(source.includes("R5"), "Recovery SoT must contain R5.");
  assert.match(source, /^R4\s+COMPLETE\s*$/m);
  assert.match(source, /^R5\s+COMPLETE\s*$/m);
  assert.match(source, /^R6\s+COMPLETE\s*$/m);
  assert.match(source, /^R7\s+(?:NEXT \/ NOT STARTED|COMPLETE)\s*$/m);
});
