import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("G4 campaign preflight fails closed without tools and signed artifacts", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/phase-g4-release-campaign-preflight.mjs", "--allow-blocked"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PHASE_G4_DISABLE_TOOL_DISCOVERY: "1",
        PHASE_G4_ADB_PATH: "",
        PHASE_G4_AAPT_PATH: "",
        PHASE_G4_JAVA_PATH: "",
        PHASE_G4_APKSIGNER_JAR: "",
        PHASE_G4_OLD_CLIENT_APK: "",
        PHASE_G4_RELEASE_CANDIDATE_APK: "",
      },
    },
  );
  const report = JSON.parse(output);
  assert.equal(report.readiness, "BLOCKED");
  assert.equal(report.certificationEvidence, false);
  assert.ok(report.blockers.includes("OLD_CLIENT_APK_NOT_PROVIDED"));
  assert.ok(report.blockers.includes("RELEASE_CANDIDATE_APK_NOT_PROVIDED"));
  assert.equal(report.destructiveApprovalRequired, true);
});

test("G4 evidence records the signed versioned upgrade without closing unrun campaign legs", async () => {
  const evidence = JSON.parse(await read("docs/architecture/TINDIO_PHASE_G4_RELEASE_CAMPAIGN_PROOF.json"));
  assert.equal(evidence.status, "IN_PROGRESS_PHYSICAL_CAMPAIGN");
  assert.equal(evidence.sameSignerVerified, true);
  assert.equal(evidence.differentArtifactHashesVerified, true);
  assert.equal(evidence.newerVersionCodeVerified, true);
  assert.ok(evidence.releaseCandidateArtifact.versionCode > evidence.oldClientArtifact.versionCode);
  assert.equal(evidence.sameSignerInPlaceUpgradePassed, true);
  assert.equal(evidence.applicationLevelProofPassed, true);
  assert.equal(evidence.authSessionPreserved, true);
  assert.equal(evidence.unsyncedEventsPreserved, true);
  assert.equal(evidence.sqliteSchemaTransition, "13_TO_13");
  assert.equal(evidence.campaignLegs.supportedOldClient, "PASS");
  assert.equal(evidence.campaignLegs.sameSignerInPlaceUpgrade, "PASS_VERSION_2_TO_3");
  assert.ok(evidence.blockers.includes("FORCED_UPGRADE_426_PHYSICAL_CAMPAIGN_NOT_RUN"));
  assert.ok(evidence.blockers.includes("PROVIDER_ROLLBACK_PHYSICAL_CAMPAIGN_NOT_RUN"));
  assert.equal(evidence.g4GateClosed, false);
  assert.equal(evidence.productionChangesMade, false);
});

test("G4 retains every required physical campaign leg", async () => {
  const preflight = await read("scripts/phase-g4-release-campaign-preflight.mjs");
  for (const leg of [
    "fresh_install",
    "supported_old_client",
    "forced_upgrade_426",
    "same_signer_in_place_upgrade",
    "provider_rollback",
  ]) assert.match(preflight, new RegExp(`\\"${leg}\\"`));
  assert.match(preflight, /RELEASE_CANDIDATE_VERSION_NOT_GREATER_THAN_OLD_CLIENT/);
  assert.match(preflight, /destructiveApprovalRequired: true/);
});
