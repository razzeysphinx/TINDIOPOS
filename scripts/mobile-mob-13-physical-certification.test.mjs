import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import test from "node:test";

const evidencePath =
  "docs/mobile-program/evidence/MOB_13_SLICE_14_PHYSICAL_ANDROID_UI.json";
const evidence = JSON.parse(fs.readFileSync(evidencePath, "utf8"));

const requiredFlows = [
  "sign-in-enrollment-assignment-preparation",
  "ready-offline",
  "catalogue-search-scan-selection",
  "cart-editing-modifiers-variable-price",
  "synthetic-online-cash-checkout",
  "synthetic-offline-cash-acceptance",
  "force-stop-cold-restart-custody",
  "receipt-visibility",
  "reconnect-recovery-sync-review",
  "keyboard-large-text",
  "talkback",
  "phone-responsive-layout",
  "tablet-responsive-layout",
];

test("MOB-13 Slice 14 records every required physical flow without false passes", () => {
  assert.equal(evidence.status, "BLOCKED");
  assert.equal(evidence.certificationEvidence, false);
  assert.deepEqual(
    evidence.campaign.map((entry) => entry.id),
    requiredFlows,
  );
  assert.deepEqual(
    Object.fromEntries(evidence.campaign.map((entry) => [entry.id, entry.result])),
    {
      "sign-in-enrollment-assignment-preparation": "NOT_RUN",
      "ready-offline": "BLOCKED",
      "catalogue-search-scan-selection": "BLOCKED",
      "cart-editing-modifiers-variable-price": "BLOCKED",
      "synthetic-online-cash-checkout": "BLOCKED",
      "synthetic-offline-cash-acceptance": "PASS",
      "force-stop-cold-restart-custody": "PASS",
      "receipt-visibility": "PASS",
      "reconnect-recovery-sync-review": "BLOCKED",
      "keyboard-large-text": "BLOCKED",
      talkback: "NOT_RUN",
      "phone-responsive-layout": "PASS",
      "tablet-responsive-layout": "NOT_RUN",
    },
  );
  assert.ok(evidence.blockers.includes("ANDROID_TO_LOCAL_API_TRANSPORT_BLOCKED"));
  assert.ok(evidence.blockers.includes("PHYSICAL_TABLET_CAMPAIGN_NOT_RUN"));
  assert.ok(evidence.blockers.includes("TALKBACK_CAMPAIGN_NOT_RUN"));
});

test("MOB-13 Slice 14 requires exact device, build, and screenshot metadata", () => {
  assert.deepEqual(evidence.requiredEvidence.deviceMetadata, [
    "manufacturer",
    "model",
    "androidVersion",
    "apiLevel",
    "abi",
    "serial",
  ]);
  assert.deepEqual(evidence.requiredEvidence.buildMetadata, [
    "sourceCommit",
    "packageId",
    "versionName",
    "versionCode",
    "artifactSha256",
    "signerCertificateSha256",
  ]);
  assert.equal(evidence.requiredEvidence.syntheticTransactionsOnly, true);
  assert.equal(evidence.requiredEvidence.screenshotsRequired, true);
  assert.equal(evidence.device.serial, "82eaaf10");
  assert.equal(evidence.build.artifactSha256.length, 64);
  assert.ok(evidence.evidenceFiles.length >= 8);
  assert.ok(evidence.evidenceFiles.every((entry) => entry.sha256.length === 64));
});

test("MOB-13 Slice 14 preflight emits machine-readable blockers", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/mobile-mob-13-physical-ui-preflight.mjs", "--allow-blocked"],
    {
      encoding: "utf8",
      env: { ...process.env, MOB13_APK_PATH: "" },
    },
  );
  const report = JSON.parse(output);

  assert.equal(report.campaign, "MOB-13 Slice 14 physical Android UI certification");
  assert.equal(report.campaignReadiness, "BLOCKED");
  assert.equal(report.certificationEvidence, false);
  assert.ok(report.preflightBlockers.includes("APK_ARTIFACT_NOT_PROVIDED"));
  assert.ok(report.certificationBlockers.includes("PHYSICAL_EVIDENCE_INCOMPLETE"));
});
