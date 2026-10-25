import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("G3 upgrade proof covers Auth and every offline custody surface without secrets", async () => {
  const proof = await read("apps/mobile/src/features/runtime/app-upgrade-proof.ts");
  for (const marker of [
    "legacySupabaseSessionPresent",
    "neonSessionPresent",
    "loadMobileDeviceIdentity",
    "readOfflineAuthorizationGrant",
    "local_receipts",
    "receiptContentDigest",
    "device_sync_state",
    "SEQUENCE_CHECKPOINT_CHANGED",
    "AUTH_SESSION_MISSING",
  ]) assert.match(proof, new RegExp(marker));
  assert.doesNotMatch(proof, /access_token|refresh_token|credential\.secret/);
});

test("G3 support UI reports the transition state and expanded upgrade proof", async () => {
  const screen = await read("apps/mobile/app/(app)/production-readiness.tsx");
  assert.match(screen, /authTransitionState/);
  assert.match(screen, /session, enrollment, offline grant/);
  assert.match(screen, /receipt\(s\)/);
  assert.match(screen, /sequence checkpoint\(s\)/);
});

test("G3 physical evidence fails closed while device and artifacts are absent", async () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/phase-g-physical-auth-upgrade-preflight.mjs", "--allow-blocked"],
    {
      encoding: "utf8",
      env: { ...process.env, PHASE_G_ADB_PATH: "", PHASE_G_BASELINE_APK: "", PHASE_G_SUCCESSOR_APK: "" },
    },
  );
  const report = JSON.parse(output);
  assert.equal(report.readiness, "BLOCKED");
  assert.equal(report.certificationEvidence, false);
  assert.ok(report.blockers.includes("PHASE_G_BASELINE_APK_NOT_PROVIDED"));
  assert.ok(report.blockers.includes("PHASE_G_SUCCESSOR_APK_NOT_PROVIDED"));

  const evidence = JSON.parse(await read("docs/architecture/TINDIO_PHASE_G_PHYSICAL_AUTH_UPGRADE_PROOF.json"));
  assert.equal(evidence.status, "BLOCKED_EXTERNAL_DEVICE_REQUIRED");
  assert.equal(evidence.physicalCertificationPassed, false);
  assert.equal(evidence.productionChangesMade, false);
});
