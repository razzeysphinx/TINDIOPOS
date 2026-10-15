import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const sourcePath = "apps/mobile/src/features/observability/android-exit-reconciliation.ts";
const source = fs.readFileSync(sourcePath, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { reconcileAndroidExitEvents } = await import(moduleUrl);

function state(overrides = {}) {
  return {
    count: 4,
    lastCrashAt: "2026-10-15T00:00:00.000Z",
    anrCount: 2,
    lastAnrAt: "2026-10-15T00:01:00.000Z",
    lastProcessedAndroidExitAtMs: 2_000,
    androidExitHistoryInitialized: true,
    processedAndroidExitFingerprints: ["NATIVE_CRASH:2000"],
    custodySentinel: "unchanged",
    ...overrides,
  };
}

test("native, Java/startup, and ANR exits are aggregated exactly once", () => {
  const events = [
    { type: "NATIVE_CRASH", timestampMs: 3_000 },
    { type: "JAVA_CRASH", timestampMs: 4_000 },
    { type: "ANR", timestampMs: 5_000 },
  ];
  const once = reconcileAndroidExitEvents(state(), events);
  const twice = reconcileAndroidExitEvents(once, events);
  assert.equal(once.count, 6);
  assert.equal(once.anrCount, 3);
  assert.equal(once.lastProcessedAndroidExitAtMs, 5_000);
  assert.deepEqual(twice, once);
  assert.equal(twice.custodySentinel, "unchanged");
});

test("clock rollback cannot suppress a new native exit", () => {
  const current = state({
    lastProcessedAndroidExitAtMs: 10_000,
    processedAndroidExitFingerprints: ["NATIVE_CRASH:10000"],
  });
  const next = reconcileAndroidExitEvents(current, [
    { type: "JAVA_CRASH", timestampMs: 9_000 },
  ]);
  assert.equal(next.count, current.count + 1);
  assert.equal(next.lastProcessedAndroidExitAtMs, 10_000, "legacy watermark must never regress");
  assert.ok(next.processedAndroidExitFingerprints.includes("JAVA_CRASH:9000"));
});

test("installed watermark-only state migrates without recounting historical exits", () => {
  const legacy = state({
    androidExitHistoryInitialized: false,
    processedAndroidExitFingerprints: [],
  });
  const next = reconcileAndroidExitEvents(legacy, [
    { type: "NATIVE_CRASH", timestampMs: 1_000 },
    { type: "ANR", timestampMs: 2_000 },
  ]);
  assert.equal(next.count, legacy.count);
  assert.equal(next.anrCount, legacy.anrCount);
  assert.equal(next.androidExitHistoryInitialized, true);
  assert.deepEqual(next.processedAndroidExitFingerprints, ["NATIVE_CRASH:1000", "ANR:2000"]);
});

test("an empty or unavailable history does not prematurely complete installed-state migration", () => {
  const legacy = state({
    androidExitHistoryInitialized: false,
    processedAndroidExitFingerprints: [],
  });
  assert.equal(reconcileAndroidExitEvents(legacy, []), legacy);
});

test("malformed and duplicate exit records cannot inflate aggregates", () => {
  const next = reconcileAndroidExitEvents(state(), [
    { type: "ANR", timestampMs: 3_000 },
    { type: "JAVA_CRASH", timestampMs: 3_000 },
    { type: "UNSUPPORTED", timestampMs: 4_000 },
    { type: "ANR", timestampMs: 3_000 },
    { type: "JAVA_CRASH", timestampMs: Number.NaN },
  ]);
  assert.equal(next.count, 5);
  assert.equal(next.anrCount, 3);
  assert.equal(next.processedAndroidExitFingerprints.filter((value) => value === "ANR:3000").length, 1);
});

test("the fingerprint ledger is bounded and contains no diagnostic payload", () => {
  const events = Array.from({ length: 80 }, (_, index) => ({
    type: "JAVA_CRASH",
    timestampMs: 20_000 + index,
  }));
  const next = reconcileAndroidExitEvents(state(), events);
  assert.equal(next.processedAndroidExitFingerprints.length, 64);
  assert.doesNotMatch(source, /error\.message|error\.stack|componentStack|payload|receipt|customer|payment|token|secret/iu);
});
