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
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.authorizedDeviceCount, 1);
  assert.equal(evidence.phaseGBaselineArtifactProvided, true);
  assert.equal(evidence.phaseGSuccessorArtifactProvided, true);
  assert.equal(evidence.sameSignerInPlaceInstallPassed, true);
  assert.equal(evidence.appDataInodePreserved, true);
  assert.equal(evidence.originalInstallIdentityPreserved, true);
  assert.equal(evidence.visibleRecoveryStatePreserved, true);
  assert.equal(evidence.postAuthFailureDiagnosed, true);
  assert.equal(evidence.postAuthFailureStage, "fetchPosV2Core");
  assert.equal(evidence.postAuthFailureCause, "HTTP_LOOPBACK_ORIGIN_BLOCKED_BY_ANDROID_CLEARTEXT_POLICY");
  assert.equal(evidence.httpsSuccessorBuildAuthorized, true);
  assert.equal(evidence.httpsSuccessorBuilt, true);
  assert.equal(evidence.httpsSuccessorInstalledSameSigner, true);
  assert.equal(evidence.httpsSuccessorAuthRetest, "BLOCKED_BY_VERCEL_PREVIEW_PROTECTION");
  assert.equal(evidence.vercelProtectionPreserved, true);
  assert.equal(evidence.bypassSecretEmbedded, false);
  assert.equal(evidence.developmentProfileBuildAuthorized, true);
  assert.equal(evidence.developmentProfileBuildStatus, "FINISHED");
  assert.equal(evidence.developmentProfileInstalledSameSigner, true);
  assert.equal(evidence.applicationLevelProofArmed, true);
  assert.equal(evidence.applicationLevelProofPassed, true);
  assert.equal(evidence.authSessionPreserved, true);
  assert.equal(evidence.deviceEnrollmentPreserved, true);
  assert.equal(evidence.offlineAuthorizationGrantPreserved, true);
  assert.equal(evidence.unsyncedEventsPreserved, true);
  assert.equal(evidence.immutableReceiptsPreserved, true);
  assert.equal(evidence.deviceSequenceCheckpointsPreserved, true);
  assert.equal(evidence.sqliteSchemaPreserved, true);
  assert.equal(evidence.physicalCertificationPassed, true);
  assert.equal(evidence.productionChangesMade, false);
});
